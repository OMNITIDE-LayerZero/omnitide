// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OFTAdapterUpgradeable } from "@layerzerolabs/oft-evm-upgradeable/contracts/oft/OFTAdapterUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title OmnitideTokenAdapter
/// @notice Hub side of the $OMNITIDE mesh: locks the launched token here and mints its OFT on every spoke, one supply.
contract OmnitideTokenAdapter is OFTAdapterUpgradeable, UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address token, address lzEndpoint) OFTAdapterUpgradeable(token, lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __OFTAdapter_init(owner_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
