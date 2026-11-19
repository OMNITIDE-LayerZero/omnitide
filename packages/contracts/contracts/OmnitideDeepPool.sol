// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IOAppComposer } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm/contracts/libs/OFTComposeMsgCodec.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";
import { OmnitideOracle } from "./OmnitideOracle.sol";

/// @title OmnitideDeepPool
/// @notice Deep Mode: one pooled clearinghouse account. Per-trader books live in the keeper's sealed ledger;
///         on-chain each book is only a commitment plus a ciphertext readable with the owner's view key.
///         A Deep id is keccak256(abi.encode(owner, salt)), so the hub never needs the owner's address to credit it.
contract OmnitideDeepPool is
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardTransient,
    IOAppComposer
{
    using SafeERC20 for IERC20;

    struct Note {
        bytes32 commitment; // keccak256(abi.encode(id, nonce, collateral, flat, detailHash))
        uint64 nonce;
        uint64 exitAt;
        uint256 exitAmount;
        address exitTo;
    }

    struct Withdrawal {
        address owner;
        bytes32 salt;
        uint256 amount;
        uint32 dstEid;
        address receiver;
        uint64 deadline;
    }

    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("DeepWithdrawal(bytes32 salt,uint256 amount,uint32 dstEid,address receiver,uint64 deadline)");
    uint64 public constant EXIT_DELAY = 1 days;

    OmnitideClearinghouse public clearinghouse;
    IERC20 public token;
    address public endpoint;
    address public operator;
    address public guardian;
    mapping(bytes32 => Note) public notes;
    mapping(bytes32 => bool) public usedWithdrawals;

    event OperatorSet(address operator);
    event DeepDeposit(bytes32 indexed id, uint256 amount, uint32 srcEid, bytes32 guid);
    event Sealed(bytes32 indexed id, uint64 nonce, bytes32 commitment, bytes ciphertext);
    event DeepWithdraw(bytes32 indexed id, uint256 amount, uint32 dstEid, address receiver, bytes32 guid);
    event ExitRequested(bytes32 indexed id, uint256 amount, address to, uint64 exitAt);
    event Exited(bytes32 indexed id, uint256 amount, address to);

    error NotOperator();
    error NotGuardian();
    error NotEndpoint();
    error ZeroAmount();
    error ZeroAddress();
    error BadSignature();
    error Expired();
    error Replayed();
    error LengthMismatch();
    error BadPreimage();
    error ExitNotReady();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address operator_, address guardian_, OmnitideClearinghouse clearinghouse_) external initializer {
        if (operator_ == address(0) || guardian_ == address(0) || address(clearinghouse_) == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        __Pausable_init();
        __EIP712_init("OMNITIDE Deep Pool", "1");
        clearinghouse = clearinghouse_;
        token = clearinghouse_.token();
        endpoint = clearinghouse_.endpoint();
        operator = operator_;
        guardian = guardian_;
        token.forceApprove(address(clearinghouse_), type(uint256).max);
    }

    // ───────────────────────── admin ─────────────────────────

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────────────────────── collateral in ─────────────────────────

    function deposit(bytes32 id, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        clearinghouse.deposit(amount);
        emit DeepDeposit(id, amount, clearinghouse.hubEid(), bytes32(0));
    }

    /// @notice Private Inflow: tdUSD sent from a spoke with composeMsg = abi.encode(bytes32 id). Retryable if it reverts.
    function lzCompose(address from, bytes32 guid, bytes calldata message, address, bytes calldata) external payable whenNotPaused {
        if (msg.sender != endpoint || from != address(token)) revert NotEndpoint();
        uint256 amount = OFTComposeMsgCodec.amountLD(message);
        bytes32 id = abi.decode(OFTComposeMsgCodec.composeMsg(message), (bytes32));
        clearinghouse.deposit(amount);
        emit DeepDeposit(id, amount, OFTComposeMsgCodec.srcEid(message), guid);
    }

    // ───────────────────────── operator ─────────────────────────

    /// @notice Pooled fill; the trade carries no Deep id, books are re-sealed in a separate batch.
    function trade(uint8 marketId, int256 sizeDelta, uint256 priceLimit, OmnitideOracle.PriceReport[] calldata reports) external onlyOperator {
        clearinghouse.trade(marketId, sizeDelta, priceLimit, reports);
    }

    function seal(bytes32[] calldata ids, bytes32[] calldata commitments, bytes[] calldata ciphertexts) external onlyOperator {
        if (ids.length != commitments.length || ids.length != ciphertexts.length) revert LengthMismatch();
        for (uint256 i; i < ids.length; ++i) _seal(ids[i], commitments[i], ciphertexts[i]);
    }

    /// @notice Pays out only with the owner's signature; the ledger balance check happens in the keeper before it submits.
    function withdraw(
        Withdrawal calldata w,
        bytes calldata signature,
        OmnitideOracle.PriceReport[] calldata reports,
        bytes32 commitment,
        bytes calldata ciphertext
    ) external payable onlyOperator nonReentrant returns (bytes32 guid) {
        if (w.amount == 0) revert ZeroAmount();
        if (block.timestamp > w.deadline) revert Expired();
        bytes32 digest = withdrawalDigest(w);
        if (usedWithdrawals[digest]) revert Replayed();
        if (!SignatureChecker.isValidSignatureNow(w.owner, digest, signature)) revert BadSignature();
        usedWithdrawals[digest] = true;
        bytes32 id = deepId(w.owner, w.salt);
        guid = clearinghouse.withdraw{ value: msg.value }(w.amount, w.dstEid, w.receiver, reports);
        _seal(id, commitment, ciphertext);
        emit DeepWithdraw(id, w.amount, w.dstEid, w.receiver, guid);
        _refund();
    }

    // ───────────────────────── escape hatch ─────────────────────────

    /// @notice If the keeper goes quiet, a flat book can leave on its own after EXIT_DELAY, provided no newer seal lands.
    function requestExit(bytes32 salt, uint256 collateral, bytes32 detailHash) external {
        bytes32 id = deepId(msg.sender, salt);
        Note storage n = notes[id];
        if (keccak256(abi.encode(id, n.nonce, collateral, true, detailHash)) != n.commitment || collateral == 0) revert BadPreimage();
        n.exitAt = uint64(block.timestamp) + EXIT_DELAY;
        n.exitAmount = collateral;
        n.exitTo = msg.sender;
        emit ExitRequested(id, collateral, msg.sender, n.exitAt);
    }

    function exit(bytes32 id, OmnitideOracle.PriceReport[] calldata reports) external nonReentrant {
        Note storage n = notes[id];
        if (n.exitAt == 0 || block.timestamp < n.exitAt) revert ExitNotReady();
        (uint256 amount, address to) = (n.exitAmount, n.exitTo);
        n.exitAt = 0;
        n.exitAmount = 0;
        n.commitment = keccak256(abi.encode(id, ++n.nonce, uint256(0), true, bytes32(0)));
        clearinghouse.withdraw(amount, clearinghouse.hubEid(), to, reports);
        emit Exited(id, amount, to);
    }

    // ───────────────────────── views ─────────────────────────

    function deepId(address owner_, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(owner_, salt));
    }

    function withdrawalDigest(Withdrawal calldata w) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(WITHDRAWAL_TYPEHASH, w.salt, w.amount, w.dstEid, w.receiver, w.deadline)));
    }

    // ───────────────────────── internals ─────────────────────────

    function _seal(bytes32 id, bytes32 commitment, bytes calldata ciphertext) private {
        Note storage n = notes[id];
        uint64 nonce = ++n.nonce;
        n.commitment = commitment;
        n.exitAt = 0; // any newer seal supersedes a pending exit
        emit Sealed(id, nonce, commitment, ciphertext);
    }

    function _refund() private {
        uint256 left = address(this).balance;
        if (left > 0) {
            (bool ok, ) = msg.sender.call{ value: left }("");
            ok; // best effort, the operator is an EOA
        }
    }

    receive() external payable {}

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
