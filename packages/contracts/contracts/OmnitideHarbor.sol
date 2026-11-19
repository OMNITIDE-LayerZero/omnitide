// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IOAppComposer } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm/contracts/libs/OFTComposeMsgCodec.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";

/// @title OmnitideHarbor (htdUSD)
/// @notice OVault for idle collateral: tdUSD here backs the Tide Pool and earns its fees, penalties and trader PnL.
contract OmnitideHarbor is
    ERC4626Upgradeable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    IOAppComposer
{
    using SafeERC20 for IERC20;

    OmnitideClearinghouse public clearinghouse;
    address public endpoint;
    uint32 public hubEid;
    address public guardian;
    IOFT public shareOFT; // OmnitideHarborShareAdapter on the hub

    event ShareOFTSet(address shareOFT);
    event Composed(bytes32 indexed guid, uint32 srcEid, address indexed receiver, uint32 dstEid, bool deposit, uint256 amountIn, uint256 amountOut, bool delivered);

    error NotEndpoint();
    error NotSelf();
    error NotGuardian();
    error UnknownSource(address from);
    error SlippageExceeded(uint256 out, uint256 minOut);
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address guardian_, OmnitideClearinghouse clearinghouse_) external initializer {
        if (guardian_ == address(0) || address(clearinghouse_) == address(0)) revert ZeroAddress();
        IERC20 token = clearinghouse_.token();
        __ERC20_init("Harbor tdUSD", "htdUSD");
        __ERC4626_init(token);
        __Ownable_init(owner_);
        __Pausable_init();
        clearinghouse = clearinghouse_;
        endpoint = clearinghouse_.endpoint();
        hubEid = clearinghouse_.hubEid();
        guardian = guardian_;
    }

    // ───────────────────────── admin ─────────────────────────

    function setShareOFT(IOFT shareOFT_) external onlyOwner {
        shareOFT = shareOFT_;
        emit ShareOFTSet(address(shareOFT_));
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────────────────────── vault ─────────────────────────

    /// @notice Everything Harbor owns sits in the Tide Pool, so its assets are the pool balance.
    function totalAssets() public view override returns (uint256) {
        int256 pool = clearinghouse.poolBalance();
        return pool > 0 ? uint256(pool) : 0;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxMint(receiver);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);
        _fundPool(assets);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares) internal override nonReentrant {
        clearinghouse.drawPool(assets, address(this));
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    function _fundPool(uint256 assets) private {
        IERC20(asset()).forceApprove(address(clearinghouse), assets);
        clearinghouse.fundPool(assets);
    }

    // ───────────────────────── OVault composer ─────────────────────────

    /// @notice composeMsg = abi.encode(receiver, dstEid, minOut); any failure hands the input to the receiver on the hub.
    function lzCompose(address from, bytes32 guid, bytes calldata message, address, bytes calldata) external payable {
        if (msg.sender != endpoint) revert NotEndpoint();
        bool isDeposit = from == asset();
        if (!isDeposit && from != address(shareOFT)) revert UnknownSource(from);

        uint256 amount = OFTComposeMsgCodec.amountLD(message);
        uint32 srcEid = OFTComposeMsgCodec.srcEid(message);
        bytes memory inner = OFTComposeMsgCodec.composeMsg(message);
        address fallbackTo = OFTComposeMsgCodec.bytes32ToAddress(OFTComposeMsgCodec.composeFrom(message));

        try this.settle{ value: msg.value }(isDeposit, amount, inner) returns (address receiver, uint32 dstEid, uint256 out) {
            emit Composed(guid, srcEid, receiver, dstEid, isDeposit, amount, out, true);
        } catch {
            if (inner.length == 96) (fallbackTo, , ) = abi.decode(inner, (address, uint32, uint256));
            if (isDeposit) IERC20(asset()).safeTransfer(fallbackTo, amount);
            else _transfer(address(this), fallbackTo, amount);
            if (msg.value > 0) {
                (bool ok, ) = fallbackTo.call{ value: msg.value }("");
                ok; // native refund is best effort; the tokens above are what matter
            }
            emit Composed(guid, srcEid, fallbackTo, hubEid, isDeposit, amount, 0, false);
        }
    }

    /// @dev Only callable by this contract from lzCompose, so a revert rolls back cleanly into the fallback.
    function settle(bool isDeposit, uint256 amount, bytes calldata inner) external payable returns (address receiver, uint32 dstEid, uint256 out) {
        if (msg.sender != address(this)) revert NotSelf();
        uint256 minOut;
        (receiver, dstEid, minOut) = abi.decode(inner, (address, uint32, uint256));
        if (receiver == address(0)) revert ZeroAddress();
        bool local = dstEid == hubEid;

        if (isDeposit) {
            if (paused()) revert EnforcedPause();
            out = previewDeposit(amount);
            if (out < minOut || out == 0) revert SlippageExceeded(out, minOut);
            _mint(local ? receiver : address(this), out);
            _fundPool(amount);
            emit Deposit(address(this), receiver, amount, out);
            if (!local) {
                _approve(address(this), address(shareOFT), out);
                _send(shareOFT, dstEid, receiver, out);
            }
        } else {
            out = previewRedeem(amount);
            if (out < minOut || out == 0) revert SlippageExceeded(out, minOut);
            clearinghouse.drawPool(out, address(this));
            _burn(address(this), amount);
            emit Withdraw(address(this), receiver, address(this), out, amount);
            if (local) IERC20(asset()).safeTransfer(receiver, out);
            else _send(IOFT(asset()), dstEid, receiver, out);
        }
        if (local && msg.value > 0) {
            (bool ok, ) = receiver.call{ value: msg.value }("");
            ok; // unused return-leg fee goes back to the receiver, best effort
        }
    }

    function _send(IOFT oft, uint32 dstEid, address receiver, uint256 amount) private {
        SendParam memory p = SendParam({
            dstEid: dstEid,
            to: OFTComposeMsgCodec.addressToBytes32(receiver),
            amountLD: amount,
            minAmountLD: amount,
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });
        oft.send{ value: msg.value }(p, MessagingFee(msg.value, 0), receiver);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
