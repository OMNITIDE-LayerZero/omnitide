// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OmnitideClearinghouse } from "../OmnitideClearinghouse.sol";

/// @dev Upgrade target used only by tests to prove storage-compatible upgrades.
/// @custom:oz-upgrades-from contracts/OmnitideClearinghouse.sol:OmnitideClearinghouse
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract OmnitideClearinghouseV2 is OmnitideClearinghouse {
    function version() external pure returns (string memory) {
        return "2";
    }
}
