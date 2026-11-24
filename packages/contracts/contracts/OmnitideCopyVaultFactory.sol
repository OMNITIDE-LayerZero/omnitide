// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import { BeaconProxy } from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";
import { OmnitideCopyVault } from "./OmnitideCopyVault.sol";
import { OmnitideOracle } from "./OmnitideOracle.sol";

/// @title OmnitideCopyVaultFactory
/// @notice Anyone can open a copy vault by seeding it; all vaults share one beacon so an upgrade reaches every one of them.
contract OmnitideCopyVaultFactory is Ownable2StepUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    OmnitideClearinghouse public clearinghouse;
    UpgradeableBeacon public beacon;
    uint256 public minSeed;
    address[] public vaults;

    event VaultCreated(address indexed vault, address indexed leader, string name, uint256 seed);

    error SeedTooSmall(uint256 minSeed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, OmnitideClearinghouse clearinghouse_, address vaultImpl, uint256 minSeed_) external initializer {
        __Ownable_init(owner_);
        clearinghouse = clearinghouse_;
        beacon = new UpgradeableBeacon(vaultImpl, owner_);
        minSeed = minSeed_;
    }

    function setMinSeed(uint256 minSeed_) external onlyOwner {
        minSeed = minSeed_;
    }

    function createVault(
        string calldata name,
        string calldata symbol,
        uint16 feeBps,
        uint256 seed,
        OmnitideOracle.PriceReport[] calldata reports
    ) external returns (address vault) {
        if (seed < minSeed) revert SeedTooSmall(minSeed);
        vault = address(new BeaconProxy(address(beacon), abi.encodeCall(OmnitideCopyVault.initialize, (msg.sender, name, symbol, clearinghouse))));
        vaults.push(vault);
        OmnitideCopyVault(payable(vault)).setFee(feeBps);
        IERC20 token = clearinghouse.token();
        token.safeTransferFrom(msg.sender, address(this), seed);
        token.forceApprove(vault, seed);
        OmnitideCopyVault(payable(vault)).deposit(seed, msg.sender, reports);
        emit VaultCreated(vault, msg.sender, name, seed);
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
