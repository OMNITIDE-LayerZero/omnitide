// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OFTAdapterUpgradeable } from "@layerzerolabs/oft-evm-upgradeable/contracts/oft/OFTAdapterUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title OmnitideHarborShareAdapter
/// @notice Hub side of the Harbor OVault: locks htdUSD here and releases it when shares come home.
contract OmnitideHarborShareAdapter is OFTAdapterUpgradeable, UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address harbor, address lzEndpoint) OFTAdapterUpgradeable(harbor, lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __OFTAdapter_init(owner_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
