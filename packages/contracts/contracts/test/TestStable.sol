// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only 6-decimal stablecoin standing in for USDG / USDC.
contract TestStable is ERC20 {
    uint8 private immutable _dec;

    constructor(uint8 dec) ERC20("Test Dollar", "tUSD") {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
