// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";
import { OmnitideLending } from "./OmnitideLending.sol";

interface IOmnitidePort {
    function deposit(uint256 amount, address to) external returns (uint256 minted);
}

/// @title OmnitideInletBox
/// @notice One account's receiving address. Holds whatever lands on it until its OmnitideInlet moves it.
contract OmnitideInletBox {
    using SafeERC20 for IERC20;

    address public inlet;

    error NotInlet();

    function init() external {
        if (inlet != address(0)) revert NotInlet();
        inlet = msg.sender;
    }

    receive() external payable {}

    function pull(IERC20 token, address to, uint256 amount) external {
        if (msg.sender != inlet) revert NotInlet();
        token.safeTransfer(to, amount);
    }

    function pullETH(address to, uint256 amount) external {
        if (msg.sender != inlet) revert NotInlet();
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert NotInlet();
    }
}

/// @title OmnitideInlet
/// @notice Deterministic per-account deposit addresses on the hub for solvers and bridges that can only transfer
///         (NEAR Intents, CEX withdrawals, plain sends). Anyone may sweep a box, but its dollars only ever reach the
///         owner's margin or loan and its ETH only the owner's Lending collateral; the owner alone may rescue it raw.
contract OmnitideInlet is Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Route {
        Margin, // dollars → clearinghouse margin
        Repay // dollars → Lending debt first, the rest to margin
    }

    address public boxImplementation;
    IERC20 public usd; // tdUSD
    IERC20 public stable; // USDG on mainnet; zero where no Port runs
    IOmnitidePort public port;
    OmnitideClearinghouse public clearinghouse;
    OmnitideLending public lending; // zero until Lending ships
    IERC20 public weth;
    address public guardian;

    event Swept(address indexed account, Route route, address box, uint256 stableIn, uint256 usdIn, uint256 repaid, uint256 toMargin, uint256 ethIn);
    event Rescued(address indexed account, Route route, address token, uint256 amount);
    event LendingSet(address lending);

    error ZeroAddress();
    error NothingToSweep();
    error NotGuardian();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address guardian_,
        OmnitideClearinghouse clearinghouse_,
        IOmnitidePort port_,
        IERC20 stable_,
        OmnitideLending lending_,
        IERC20 weth_
    ) external initializer {
        if (guardian_ == address(0) || address(clearinghouse_) == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        __Pausable_init();
        boxImplementation = address(new OmnitideInletBox());
        clearinghouse = clearinghouse_;
        usd = clearinghouse_.token();
        port = port_;
        stable = stable_;
        lending = lending_;
        weth = weth_;
        guardian = guardian_;
    }

    receive() external payable {}

    function setLending(OmnitideLending lending_) external onlyOwner {
        lending = lending_;
        emit LendingSet(address(lending_));
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice The address to send funds to for `account` on `route`. It receives before any code is deployed there.
    function inletOf(address account, Route route) public view returns (address) {
        return Clones.predictDeterministicAddress(boxImplementation, _salt(account, route));
    }

    /// @notice What is waiting in a box: dollars (stablecoin + tdUSD, 6 dp) and ETH (native + WETH, 18 dp).
    function pending(address account, Route route) external view returns (uint256 dollars, uint256 eth) {
        address box = inletOf(account, route);
        dollars = usd.balanceOf(box) + (address(stable) == address(0) ? 0 : stable.balanceOf(box));
        eth = box.balance + (address(weth) == address(0) ? 0 : weth.balanceOf(box));
    }

    /// @notice Move everything in `account`'s box to where it belongs. Anyone may call; nothing can leave for anyone else.
    function sweep(address account, Route route) external nonReentrant whenNotPaused {
        OmnitideInletBox box = _box(account, route);
        uint256 stableIn = address(stable) == address(0) ? 0 : stable.balanceOf(address(box));
        uint256 dollars;
        if (stableIn > 0) {
            box.pull(stable, address(this), stableIn);
            stable.forceApprove(address(port), stableIn);
            dollars = port.deposit(stableIn, address(this));
        }
        uint256 usdIn = usd.balanceOf(address(box));
        if (usdIn > 0) {
            box.pull(usd, address(this), usdIn);
            dollars += usdIn;
        }

        uint256 repaid;
        if (dollars > 0 && route == Route.Repay && address(lending) != address(0)) {
            uint256 debt = lending.debtOf(account);
            if (debt > 0) {
                usd.forceApprove(address(lending), dollars);
                repaid = lending.repay(dollars, account);
            }
        }
        uint256 toMargin = dollars - repaid;
        if (toMargin > 0) {
            usd.forceApprove(address(clearinghouse), toMargin);
            clearinghouse.depositFor(account, toMargin);
        }

        uint256 ethIn;
        if (address(lending) != address(0)) {
            uint256 native = address(box).balance;
            if (native > 0) {
                box.pullETH(address(this), native);
                lending.depositETH{ value: native }(account);
            }
            uint256 wrapped = address(weth) == address(0) ? 0 : weth.balanceOf(address(box));
            if (wrapped > 0) {
                box.pull(weth, address(this), wrapped);
                weth.forceApprove(address(lending), wrapped);
                lending.depositCollateral(wrapped, account);
            }
            ethIn = native + wrapped;
        }
        if (dollars == 0 && ethIn == 0) revert NothingToSweep();
        emit Swept(account, route, address(box), stableIn, usdIn, repaid, toMargin, ethIn);
    }

    /// @notice The owner takes a box's raw contents back to their own address on the hub; `token` zero means native ETH. Open while paused.
    function rescue(Route route, IERC20 token) external nonReentrant {
        OmnitideInletBox box = _box(msg.sender, route);
        uint256 amount;
        if (address(token) == address(0)) {
            amount = address(box).balance;
            if (amount > 0) box.pullETH(msg.sender, amount);
        } else {
            amount = token.balanceOf(address(box));
            if (amount > 0) box.pull(token, msg.sender, amount);
        }
        if (amount == 0) revert NothingToSweep();
        emit Rescued(msg.sender, route, address(token), amount);
    }

    function _box(address account, Route route) private returns (OmnitideInletBox) {
        if (account == address(0)) revert ZeroAddress();
        address at = inletOf(account, route);
        if (at.code.length == 0) {
            Clones.cloneDeterministic(boxImplementation, _salt(account, route));
            OmnitideInletBox(payable(at)).init();
        }
        return OmnitideInletBox(payable(at));
    }

    function _salt(address account, Route route) private pure returns (bytes32) {
        return keccak256(abi.encode(account, route));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
