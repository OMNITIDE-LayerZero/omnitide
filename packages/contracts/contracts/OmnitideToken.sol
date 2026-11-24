// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OFTUpgradeable } from "@layerzerolabs/oft-evm-upgradeable/contracts/oft/OFTUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title OmnitideToken
/// @notice Governance token with one supply across chains (LayerZero OFT): TIDE on testnet (faucet drips 1,000 a day),
///         the $OMNITIDE OFT on mainnet spokes, paired with OmnitideTokenAdapter on the hub.
contract OmnitideToken is OFTUpgradeable, UUPSUpgradeable {
    uint256 public constant DRIP_AMOUNT = 1_000e18;
    uint256 public constant DRIP_COOLDOWN = 1 days;

    bool public faucetEnabled;
    mapping(address => uint256) public lastDrip;

    event Dripped(address indexed to, uint256 amount);

    error FaucetClosed();
    error DripCooldown(uint256 nextAt);

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OFTUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, string calldata symbol_, bool faucetEnabled_) external initializer {
        __Ownable_init(owner_);
        __OFT_init("OMNITIDE", symbol_, owner_);
        faucetEnabled = faucetEnabled_;
    }

    function drip() external {
        if (!faucetEnabled) revert FaucetClosed();
        uint256 nextAt = lastDrip[msg.sender] + DRIP_COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < nextAt) revert DripCooldown(nextAt);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP_AMOUNT);
        emit Dripped(msg.sender, DRIP_AMOUNT);
    }

    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
