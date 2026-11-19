// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OAppUpgradeable, Origin, MessagingFee } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/OAppUpgradeable.sol";
import { OAppOptionsType3Upgradeable } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/libs/OAppOptionsType3Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title OmnitideLighthouse
/// @notice Lighthouse Proof: a keeper-attested Book Score that any protocol can read on any chain, without the positions behind it.
contract OmnitideLighthouse is OAppUpgradeable, OAppOptionsType3Upgradeable, EIP712Upgradeable, UUPSUpgradeable {
    struct Beam {
        address account;
        uint8 score; // 0..100
        uint8 grade; // 0 = A … 3 = D
        uint64 issuedAt;
        uint64 expiry;
    }

    struct Stored {
        uint8 score;
        uint8 grade;
        uint64 issuedAt;
        uint64 expiry;
        uint32 srcEid;
    }

    uint16 public constant SEND = 1;
    bytes32 public constant BEAM_TYPEHASH = keccak256("Beam(address account,uint8 score,uint8 grade,uint64 issuedAt,uint64 expiry)");

    address public attester;
    mapping(address => Stored) public beams;

    event AttesterSet(address attester);
    event BeamLit(address indexed account, uint8 score, uint8 grade, uint64 issuedAt, uint64 expiry, uint32 srcEid);
    event BeamSent(address indexed account, uint32 dstEid, bytes32 guid);

    error BadAttestation();
    error Stale();
    error FeeTooLow(uint256 required);

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OAppUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, address attester_) external initializer {
        __Ownable_init(owner_);
        __OApp_init(owner_);
        __OAppOptionsType3_init();
        __EIP712_init("OMNITIDE Lighthouse", "1");
        attester = attester_;
    }

    function setAttester(address attester_) external onlyOwner {
        attester = attester_;
        emit AttesterSet(attester_);
    }

    /// @notice Light the beam here and send it to every chain in dstEids. msg.value must cover quoteShine.
    function shine(Beam calldata b, bytes calldata signature, uint32[] calldata dstEids) external payable {
        if (ECDSA.recover(beamDigest(b), signature) != attester) revert BadAttestation();
        if (b.issuedAt <= beams[b.account].issuedAt || b.expiry <= block.timestamp) revert Stale();
        _light(b, localEid());
        bytes memory payload = abi.encode(b);
        uint256 spent;
        for (uint256 i; i < dstEids.length; ++i) {
            bytes memory options = enforcedOptions(dstEids[i], SEND);
            MessagingFee memory fee = _quote(dstEids[i], payload, options, false);
            spent += fee.nativeFee;
            if (spent > msg.value) revert FeeTooLow(spent);
            emit BeamSent(b.account, dstEids[i], _lzSend(dstEids[i], payload, options, fee, msg.sender).guid);
        }
        if (msg.value > spent) {
            (bool ok, ) = msg.sender.call{ value: msg.value - spent }("");
            ok;
        }
    }

    function quoteShine(Beam calldata b, uint32[] calldata dstEids) external view returns (uint256 total) {
        bytes memory payload = abi.encode(b);
        for (uint256 i; i < dstEids.length; ++i) total += _quote(dstEids[i], payload, enforcedOptions(dstEids[i], SEND), false).nativeFee;
    }

    function scoreOf(address account) external view returns (uint8 score, uint8 grade, uint64 issuedAt, uint64 expiry, bool live) {
        Stored memory s = beams[account];
        return (s.score, s.grade, s.issuedAt, s.expiry, s.expiry > block.timestamp);
    }

    function beamDigest(Beam calldata b) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BEAM_TYPEHASH, b.account, b.score, b.grade, b.issuedAt, b.expiry)));
    }

    function localEid() public view returns (uint32) {
        return endpoint.eid();
    }

    function _lzReceive(Origin calldata origin, bytes32, bytes calldata message, address, bytes calldata) internal override {
        Beam memory b = abi.decode(message, (Beam));
        if (b.issuedAt > beams[b.account].issuedAt) _light(b, origin.srcEid);
    }

    function _light(Beam memory b, uint32 srcEid) private {
        beams[b.account] = Stored(b.score, b.grade, b.issuedAt, b.expiry, srcEid);
        emit BeamLit(b.account, b.score, b.grade, b.issuedAt, b.expiry, srcEid);
    }

    // several sends share one msg.value; shine() checks the running total
    function _payNative(uint256 nativeFee) internal pure override returns (uint256) {
        return nativeFee;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
