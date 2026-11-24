// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IOAppComposer } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm/contracts/libs/OFTComposeMsgCodec.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";
import { OmnitideOracle } from "./OmnitideOracle.sol";

/// @title OmnitideCopyVault
/// @notice One leader trades, followers hold shares of the vault's clearinghouse account. Behind a beacon, so every vault upgrades together.
///         NAV = account equity at signed prices; deposits arriving through LayerZero queue until settle() prices them.
///         The leader earns feeBps of every gain above the high-water mark, paid in new shares whenever NAV is touched.
contract OmnitideCopyVault is Initializable, ERC20Upgradeable, ReentrancyGuardTransient, IOAppComposer {
    using SafeERC20 for IERC20;
    using SafeCast for int256;

    OmnitideClearinghouse public clearinghouse;
    IERC20 public token;
    address public endpoint;
    address public leader;
    address public factory;
    mapping(address => uint256) public pending;
    uint256 public pendingTotal;
    uint16 public feeBps; // leader's cut of gains above the high-water mark
    uint256 public highWaterMark; // assets per share, 1e18

    uint16 public constant MAX_FEE_BPS = 2_000;

    event Deposited(address indexed account, uint256 assets, uint256 shares, uint32 srcEid);
    event Queued(address indexed account, uint256 assets, uint32 srcEid, bytes32 guid);
    event Redeemed(address indexed account, uint256 shares, uint256 assets, uint32 dstEid, address receiver);
    event LeaderTrade(uint8 indexed marketId, int256 sizeDelta);
    event FeeSet(uint16 feeBps);
    event FeeCharged(uint256 shares, uint256 assets, uint256 highWaterMark);

    error NotLeader();
    error NotEndpoint();
    error ZeroAmount();
    error NothingPending();
    error FeeLocked();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address leader_, string calldata name_, string calldata symbol_, OmnitideClearinghouse clearinghouse_) external initializer {
        __ERC20_init(name_, symbol_);
        clearinghouse = clearinghouse_;
        token = clearinghouse_.token();
        endpoint = clearinghouse_.endpoint();
        leader = leader_;
        factory = msg.sender;
        token.forceApprove(address(clearinghouse_), type(uint256).max);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Net asset value in tdUSD units: account equity at the supplied prices, floored at zero.
    function nav(OmnitideOracle.PriceReport[] calldata reports) public view returns (uint256) {
        (int256 equity, , ) = clearinghouse.accountMargin(address(this), reports);
        return equity > 0 ? uint256(equity) / 1e12 : 0;
    }

    /// @notice Set once by the factory at creation (max 20%); afterwards the leader can only lower it.
    function setFee(uint16 feeBps_) external {
        bool opening = msg.sender == factory && totalSupply() == 0;
        if (feeBps_ > MAX_FEE_BPS || (!opening && (msg.sender != leader || feeBps_ > feeBps))) revert FeeLocked();
        feeBps = feeBps_;
        emit FeeSet(feeBps_);
    }

    /// @notice Shares the leader would be paid right now at this NAV.
    function pendingFee(uint256 value) public view returns (uint256 shares, uint256 pps) {
        uint256 supply = totalSupply();
        if (supply == 0 || value == 0) return (0, highWaterMark);
        pps = (value * 1e18) / supply;
        if (highWaterMark == 0 || pps <= highWaterMark || feeBps == 0) return (0, pps);
        uint256 fee = ((pps - highWaterMark) * supply * feeBps) / 1e18 / 10_000;
        if (fee >= value) return (0, pps);
        shares = (fee * supply) / (value - fee);
        pps = (value * 1e18) / (supply + shares);
    }

    function deposit(uint256 assets, address receiver, OmnitideOracle.PriceReport[] calldata reports) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 value = _crystallize(nav(reports));
        token.safeTransferFrom(msg.sender, address(this), assets);
        shares = _enter(receiver, assets, value, clearinghouse.hubEid());
    }

    /// @notice Omnichain deposit: tdUSD from a spoke with composeMsg = abi.encode(receiver); priced later by settle().
    function lzCompose(address from, bytes32 guid, bytes calldata message, address, bytes calldata) external payable {
        if (msg.sender != endpoint || from != address(token)) revert NotEndpoint();
        uint256 amount = OFTComposeMsgCodec.amountLD(message);
        address receiver = abi.decode(OFTComposeMsgCodec.composeMsg(message), (address));
        pending[receiver] += amount;
        pendingTotal += amount;
        emit Queued(receiver, amount, OFTComposeMsgCodec.srcEid(message), guid);
    }

    /// @notice Anyone (normally the keeper) prices queued deposits at the live NAV.
    function settle(address[] calldata accounts, OmnitideOracle.PriceReport[] calldata reports) external nonReentrant {
        uint256 value = _crystallize(nav(reports));
        uint256 done;
        for (uint256 i; i < accounts.length; ++i) {
            uint256 assets = pending[accounts[i]];
            if (assets == 0) continue;
            pending[accounts[i]] = 0;
            pendingTotal -= assets;
            _enter(accounts[i], assets, value, 0);
            value += assets;
            ++done;
        }
        if (done == 0) revert NothingPending();
    }

    /// @notice Redeem to this chain (dstEid == hub) or straight out to a spoke; msg.value pays LayerZero for the latter.
    function redeem(
        uint256 shares,
        uint32 dstEid,
        address receiver,
        OmnitideOracle.PriceReport[] calldata reports
    ) external payable nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        uint256 value = _crystallize(nav(reports)); // mints fee shares first, so totalSupply() below must come after
        assets = (shares * value) / totalSupply();
        if (assets == 0) revert ZeroAmount();
        _burn(msg.sender, shares);
        clearinghouse.withdraw{ value: msg.value }(assets, dstEid, receiver, reports);
        emit Redeemed(msg.sender, shares, assets, dstEid, receiver);
        uint256 left = address(this).balance;
        if (left > 0) {
            (bool ok, ) = msg.sender.call{ value: left }("");
            ok;
        }
    }

    function trade(uint8 marketId, int256 sizeDelta, uint256 priceLimit, OmnitideOracle.PriceReport[] calldata reports) external {
        if (msg.sender != leader) revert NotLeader();
        clearinghouse.trade(marketId, sizeDelta, priceLimit, reports);
        emit LeaderTrade(marketId, sizeDelta);
    }

    /// @dev Pays the leader on gains above the mark and moves the mark up; the first touch (or an upgraded vault) only sets it.
    function _crystallize(uint256 value) private returns (uint256) {
        (uint256 shares, uint256 pps) = pendingFee(value);
        if (shares > 0) {
            _mint(leader, shares);
            emit FeeCharged(shares, (value * shares) / totalSupply(), pps);
        }
        if (pps > highWaterMark) highWaterMark = pps;
        return value;
    }

    function _enter(address receiver, uint256 assets, uint256 value, uint32 srcEid) private returns (uint256 shares) {
        uint256 supply = totalSupply();
        // the factory seeds every vault at creation, so supply == 0 only happens on that first deposit
        shares = supply == 0 || value == 0 ? assets : (assets * supply) / value;
        if (shares == 0) revert ZeroAmount();
        if (supply == 0) highWaterMark = 1e18;
        clearinghouse.deposit(assets);
        _mint(receiver, shares);
        emit Deposited(receiver, assets, shares, srcEid);
    }

    receive() external payable {}
}
