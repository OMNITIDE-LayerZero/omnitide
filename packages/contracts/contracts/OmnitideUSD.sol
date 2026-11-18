// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OFTUpgradeable } from "@layerzerolabs/oft-evm-upgradeable/contracts/oft/OFTUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/// @title OmnitideUSD (tdUSD)
/// @notice Omnichain collateral for OMNITIDE, moved between chains with LayerZero OFT.
contract OmnitideUSD is OFTUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    struct RateLimit {
        uint128 limit; // max amount per window, 0 = pathway closed
        uint32 window; // seconds
        uint128 inFlight; // amount sent in the current window
        uint64 windowStart;
    }

    uint256 public constant DRIP_AMOUNT = 1_000e6;
    uint256 public constant DRIP_COOLDOWN = 1 days;

    address public guardian;
    bool public faucetEnabled;
    mapping(address => uint256) public lastDrip;
    mapping(uint32 => RateLimit) public rateLimits;

    event GuardianSet(address guardian);
    event Dripped(address indexed to, uint256 amount);
    event RateLimitSet(uint32 indexed dstEid, uint128 limit, uint32 window);

    error NotGuardian();
    error ZeroAddress();
    error FaucetDisabled();
    error DripCooldown(uint256 availableAt);
    error RateLimitExceeded(uint32 dstEid, uint256 available);

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OFTUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, address guardian_, bool faucetEnabled_) external initializer {
        __Ownable_init(owner_);
        __OFT_init("OMNITIDE Dollar", "tdUSD", owner_);
        __Pausable_init();
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        faucetEnabled = faucetEnabled_;
        emit GuardianSet(guardian_);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Testnet faucet: 1,000 tdUSD per address per day.
    function drip() external whenNotPaused {
        if (!faucetEnabled) revert FaucetDisabled();
        uint256 next = lastDrip[msg.sender] + DRIP_COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < next) revert DripCooldown(next);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP_AMOUNT);
        emit Dripped(msg.sender, DRIP_AMOUNT);
    }

    /// @notice Testnet treasury mint (seeds the Tide Pool); disabled together with the faucet.
    function faucetMint(address to, uint256 amount) external onlyOwner {
        if (!faucetEnabled) revert FaucetDisabled();
        _mint(to, amount);
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
    }

    function setRateLimit(uint32 dstEid, uint128 limit, uint32 window) external onlyOwner {
        RateLimit storage r = rateLimits[dstEid];
        r.limit = limit;
        r.window = window;
        emit RateLimitSet(dstEid, limit, window);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Amount that can still leave toward `dstEid` in the current window.
    function availableToSend(uint32 dstEid) public view returns (uint256) {
        RateLimit memory r = rateLimits[dstEid];
        if (r.limit == 0) return 0;
        if (block.timestamp >= uint256(r.windowStart) + r.window) return r.limit;
        return r.limit > r.inFlight ? r.limit - r.inFlight : 0;
    }

    function _debit(
        address from,
        uint256 amountLD,
        uint256 minAmountLD,
        uint32 dstEid
    ) internal override whenNotPaused returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        (amountSentLD, amountReceivedLD) = super._debit(from, amountLD, minAmountLD, dstEid);
        _consume(dstEid, amountSentLD);
    }

    function _consume(uint32 dstEid, uint256 amount) private {
        RateLimit storage r = rateLimits[dstEid];
        uint256 available = availableToSend(dstEid);
        if (amount > available) revert RateLimitExceeded(dstEid, available);
        if (block.timestamp >= uint256(r.windowStart) + r.window) {
            r.windowStart = uint64(block.timestamp);
            r.inFlight = uint128(amount);
        } else {
            r.inFlight += uint128(amount);
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
