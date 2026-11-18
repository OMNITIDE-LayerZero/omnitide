// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title OmnitideOracle
/// @notice Verifies EIP-712 price reports signed by authorised keepers.
contract OmnitideOracle is Ownable2StepUpgradeable, EIP712Upgradeable, UUPSUpgradeable {
    struct PriceReport {
        bytes32 feed; // e.g. "BTC-USD"
        uint256 price; // USD, 18 decimals
        uint64 timestamp;
        bytes signature;
    }

    bytes32 public constant REPORT_TYPEHASH = keccak256("PriceReport(bytes32 feed,uint256 price,uint64 timestamp)");

    mapping(address => bool) public isSigner;
    uint64 public maxAge;

    event SignerSet(address indexed signer, bool allowed);
    event MaxAgeSet(uint64 maxAge);

    error UnknownSigner(address signer);
    error StaleReport(bytes32 feed, uint64 timestamp);
    error FutureReport(bytes32 feed, uint64 timestamp);
    error ZeroPrice(bytes32 feed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address signer, uint64 maxAge_) external initializer {
        __Ownable_init(owner_);
        __EIP712_init("OmnitideOracle", "1");
        isSigner[signer] = true;
        maxAge = maxAge_;
        emit SignerSet(signer, true);
        emit MaxAgeSet(maxAge_);
    }

    function setSigner(address signer, bool allowed) external onlyOwner {
        isSigner[signer] = allowed;
        emit SignerSet(signer, allowed);
    }

    function setMaxAge(uint64 maxAge_) external onlyOwner {
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    /// @notice Returns the verified price of one report or reverts.
    function verify(PriceReport calldata r) public view returns (uint256) {
        if (r.price == 0) revert ZeroPrice(r.feed);
        if (r.timestamp > block.timestamp + 5) revert FutureReport(r.feed, r.timestamp);
        if (block.timestamp > r.timestamp + maxAge) revert StaleReport(r.feed, r.timestamp);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REPORT_TYPEHASH, r.feed, r.price, r.timestamp)));
        address signer = ECDSA.recover(digest, r.signature);
        if (!isSigner[signer]) revert UnknownSigner(signer);
        return r.price;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
