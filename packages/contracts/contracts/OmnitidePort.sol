// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SendParam, MessagingFee, MessagingReceipt } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { OmnitideUSD } from "./OmnitideUSD.sol";

/// @title OmnitidePort
/// @notice Mints tdUSD 1:1 against this chain's dollar stablecoin (USDG on Robinhood Chain, USDC elsewhere)
///         and redeems it back from the local reserve. tdUSD supply on every chain is backed by Port reserves.
contract OmnitidePort is Ownable2StepUpgradeable, PausableUpgradeable, ReentrancyGuardTransient, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public stable;
    OmnitideUSD public usd;
    address public guardian;

    event Deposited(address indexed from, address indexed to, uint256 amount, bytes32 guid);
    event Redeemed(address indexed from, address indexed to, uint256 amount);
    event GuardianSet(address guardian);

    error ZeroAmount();
    error ZeroAddress();
    error NotGuardian();
    error DecimalsMismatch();
    error InsufficientReserve(uint256 reserve, uint256 amount);
    error NoBeneficiary();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address guardian_, IERC20 stable_, OmnitideUSD usd_) external initializer {
        if (guardian_ == address(0) || address(stable_) == address(0) || address(usd_) == address(0)) revert ZeroAddress();
        if (IERC20Metadata(address(stable_)).decimals() != usd_.decimals()) revert DecimalsMismatch();
        __Ownable_init(owner_);
        __Pausable_init();
        stable = stable_;
        usd = usd_;
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Stablecoin in, the same amount of tdUSD to `to` on this chain.
    function deposit(uint256 amount, address to) external nonReentrant whenNotPaused returns (uint256 minted) {
        if (to == address(0)) revert ZeroAddress();
        minted = _pull(amount);
        usd.mint(to, minted);
        emit Deposited(msg.sender, to, minted, bytes32(0));
    }

    /// @notice Inflow in one call: stablecoin in here, tdUSD out over LayerZero (e.g. composed into the hub clearinghouse).
    /// @dev A composed send must name its beneficiary in `composeMsg`, else the hub would credit this Port; plain sends go to the caller.
    function depositAndSend(uint256 amount, SendParam calldata p) external payable nonReentrant whenNotPaused returns (bytes32 guid) {
        if (p.composeMsg.length == 0 && p.to != bytes32(uint256(uint160(msg.sender)))) revert NoBeneficiary();
        uint256 minted = _pull(amount);
        usd.mint(address(this), minted);
        SendParam memory q = p;
        q.amountLD = minted;
        (MessagingReceipt memory r, ) = usd.send{ value: msg.value }(q, MessagingFee(msg.value, 0), msg.sender);
        guid = r.guid;
        emit Deposited(msg.sender, address(this), minted, guid);
    }

    /// @notice tdUSD burned, the same amount of stablecoin out of this chain's reserve. Open even while paused.
    function redeem(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 available = stable.balanceOf(address(this));
        if (amount > available) revert InsufficientReserve(available, amount);
        usd.burn(msg.sender, amount);
        stable.safeTransfer(to, amount);
        emit Redeemed(msg.sender, to, amount);
    }

    function reserve() external view returns (uint256) {
        return stable.balanceOf(address(this));
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // mints what actually arrived, so a fee-on-transfer stablecoin can never over-mint
    function _pull(uint256 amount) private returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();
        uint256 before = stable.balanceOf(address(this));
        stable.safeTransferFrom(msg.sender, address(this), amount);
        received = stable.balanceOf(address(this)) - before;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
