// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OFTUpgradeable } from "@layerzerolabs/oft-evm-upgradeable/contracts/oft/OFTUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title OmnitideHarborShare (htdUSD on spokes)
/// @notice Harbor vault shares minted on a spoke when they arrive from the hub, burned when they leave.
contract OmnitideHarborShare is OFTUpgradeable, UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OFTUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __OFT_init("Harbor tdUSD", "htdUSD", owner_);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
