// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OAppUpgradeable, Origin, MessagingFee } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/OAppUpgradeable.sol";
import { OAppOptionsType3Upgradeable } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/libs/OAppOptionsType3Upgradeable.sol";
import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @title OmnitideBadge (Arena Badges)
/// @notice Achievement NFTs minted on the hub against a keeper attestation, then free to travel as a LayerZero ONFT.
contract OmnitideBadge is ERC721Upgradeable, OAppUpgradeable, OAppOptionsType3Upgradeable, EIP712Upgradeable, UUPSUpgradeable {
    uint16 public constant SEND = 1;
    uint8 public constant KINDS = 8;
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address to,uint8 kind,uint64 deadline)");

    address public attester;
    bool public home; // only the home chain mints
    uint256 public nextId;
    string public baseURI;
    mapping(uint256 => uint8) public kindOf;
    mapping(address => mapping(uint8 => bool)) public claimed;

    event AttesterSet(address attester);
    event BadgeClaimed(address indexed to, uint256 indexed tokenId, uint8 kind);
    event BadgeSent(address indexed from, uint256 indexed tokenId, uint32 dstEid, address to, bytes32 guid);
    event BadgeReceived(address indexed to, uint256 indexed tokenId, uint32 srcEid, uint8 kind);

    error NotHome();
    error BadAttestation();
    error Expired();
    error AlreadyClaimed();
    error UnknownKind();
    error NotOwner();

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OAppUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, address attester_, bool home_, string calldata baseURI_) external initializer {
        __ERC721_init("OMNITIDE Arena Badge", "TIDEBADGE");
        __Ownable_init(owner_);
        __OApp_init(owner_);
        __OAppOptionsType3_init();
        __EIP712_init("OMNITIDE Arena", "1");
        attester = attester_;
        home = home_;
        baseURI = baseURI_;
        nextId = 1;
    }

    function setAttester(address attester_) external onlyOwner {
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        baseURI = baseURI_;
    }

    function claim(uint8 kind, uint64 deadline, bytes calldata signature) external returns (uint256 tokenId) {
        if (!home) revert NotHome();
        if (kind >= KINDS) revert UnknownKind();
        if (block.timestamp > deadline) revert Expired();
        if (claimed[msg.sender][kind]) revert AlreadyClaimed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender, kind, deadline)));
        if (ECDSA.recover(digest, signature) != attester) revert BadAttestation();
        claimed[msg.sender][kind] = true;
        tokenId = nextId++;
        kindOf[tokenId] = kind;
        _mint(msg.sender, tokenId);
        emit BadgeClaimed(msg.sender, tokenId, kind);
    }

    /// @notice ONFT send: burn here, mint the same id and kind on dstEid.
    function send(uint32 dstEid, address to, uint256 tokenId) external payable returns (bytes32 guid) {
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        uint8 kind = kindOf[tokenId];
        _burn(tokenId);
        delete kindOf[tokenId];
        guid = _lzSend(dstEid, abi.encode(to, tokenId, kind), enforcedOptions(dstEid, SEND), MessagingFee(msg.value, 0), msg.sender).guid;
        emit BadgeSent(msg.sender, tokenId, dstEid, to, guid);
    }

    function quoteSend(uint32 dstEid, address to, uint256 tokenId) external view returns (uint256) {
        return _quote(dstEid, abi.encode(to, tokenId, kindOf[tokenId]), enforcedOptions(dstEid, SEND), false).nativeFee;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseURI, Strings.toString(kindOf[tokenId]), "/", Strings.toString(tokenId));
    }

    function _lzReceive(Origin calldata origin, bytes32, bytes calldata message, address, bytes calldata) internal override {
        (address to, uint256 tokenId, uint8 kind) = abi.decode(message, (address, uint256, uint8));
        kindOf[tokenId] = kind;
        _mint(to, tokenId); // plain mint: a contract receiver can never block delivery
        emit BadgeReceived(to, tokenId, origin.srcEid, kind);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
