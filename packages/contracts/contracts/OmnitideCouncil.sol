// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OAppUpgradeable, Origin, MessagingFee } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/OAppUpgradeable.sol";
import { OAppOptionsType3Upgradeable } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/libs/OAppOptionsType3Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title OmnitideCouncil
/// @notice Cross-chain governance: stake TIDE on any chain, vote from where it sits; the hub tallies every chain.
///         Weight counts only stake older than the proposal, and voting locks that stake until the vote closes,
///         so the same TIDE can't be moved and counted twice.
contract OmnitideCouncil is OAppUpgradeable, OAppOptionsType3Upgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Proposal {
        uint64 start;
        uint64 end;
        uint128 forVotes;
        uint128 againstVotes;
        uint128 abstainVotes;
    }

    uint16 public constant PROPOSE = 1;
    uint16 public constant VOTE = 2;

    IERC20 public tide;
    uint32 public hubEid;
    uint64 public votingPeriod;
    uint256 public proposalThreshold;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public staked;
    mapping(address => uint64) public stakedAt;
    mapping(address => uint64) public lockedUntil;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public totalStaked;

    event Staked(address indexed account, uint256 amount, uint256 total);
    event Unstaked(address indexed account, uint256 amount, uint256 total);
    event ProposalCreated(uint256 indexed id, address indexed proposer, uint64 start, uint64 end, string title, string body);
    event ProposalMirrored(uint256 indexed id, uint64 start, uint64 end, uint32 srcEid);
    event VoteCast(uint256 indexed id, address indexed voter, uint8 support, uint256 weight, uint32 eid);
    event VoteTallied(uint256 indexed id, address indexed voter, uint8 support, uint256 weight, uint32 srcEid);
    event ParamsSet(uint64 votingPeriod, uint256 proposalThreshold);

    error NotHub();
    error BelowThreshold(uint256 required);
    error VotingClosed(uint256 id);
    error AlreadyVoted();
    error NoWeight();
    error BadSupport();
    error Locked(uint64 until);
    error InsufficientStake();
    error ZeroAmount();
    error FeeTooLow(uint256 required);

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OAppUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, IERC20 tide_, uint32 hubEid_, uint64 votingPeriod_, uint256 proposalThreshold_) external initializer {
        __Ownable_init(owner_);
        __OApp_init(owner_);
        __OAppOptionsType3_init();
        tide = tide_;
        hubEid = hubEid_;
        votingPeriod = votingPeriod_;
        proposalThreshold = proposalThreshold_;
    }

    function setParams(uint64 votingPeriod_, uint256 proposalThreshold_) external onlyOwner {
        votingPeriod = votingPeriod_;
        proposalThreshold = proposalThreshold_;
        emit ParamsSet(votingPeriod_, proposalThreshold_);
    }

    // ───────────────────────── stake ─────────────────────────

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        tide.safeTransferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        stakedAt[msg.sender] = uint64(block.timestamp);
        emit Staked(msg.sender, amount, staked[msg.sender]);
    }

    function unstake(uint256 amount) external nonReentrant {
        if (block.timestamp < lockedUntil[msg.sender]) revert Locked(lockedUntil[msg.sender]);
        if (amount == 0 || amount > staked[msg.sender]) revert InsufficientStake();
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        tide.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, staked[msg.sender]);
    }

    // ───────────────────────── govern ─────────────────────────

    /// @notice Hub only. Mirrors the voting window to every chain in dstEids so their stakers can vote locally.
    function propose(string calldata title, string calldata body, uint32[] calldata dstEids) external payable nonReentrant returns (uint256 id) {
        if (localEid() != hubEid) revert NotHub();
        if (staked[msg.sender] < proposalThreshold) revert BelowThreshold(proposalThreshold);
        id = ++proposalCount;
        uint64 start = uint64(block.timestamp);
        uint64 end = start + votingPeriod;
        proposals[id] = Proposal(start, end, 0, 0, 0);
        emit ProposalCreated(id, msg.sender, start, end, title, body);
        bytes memory payload = abi.encode(PROPOSE, abi.encode(id, start, end));
        uint256 spent;
        for (uint256 i; i < dstEids.length; ++i) {
            bytes memory options = enforcedOptions(dstEids[i], PROPOSE);
            MessagingFee memory fee = _quote(dstEids[i], payload, options, false);
            spent += fee.nativeFee;
            if (spent > msg.value) revert FeeTooLow(spent);
            _lzSend(dstEids[i], payload, options, fee, msg.sender);
        }
        _refund(msg.value - spent);
    }

    /// @param support 0 against, 1 for, 2 abstain. On a spoke msg.value pays the trip to the hub (quoteVote).
    function castVote(uint256 id, uint8 support) external payable nonReentrant {
        if (support > 2) revert BadSupport();
        Proposal memory p = proposals[id];
        if (p.start == 0 || block.timestamp > p.end) revert VotingClosed(id);
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();
        uint256 weight = stakedAt[msg.sender] < p.start ? staked[msg.sender] : 0;
        if (weight == 0) revert NoWeight();
        hasVoted[id][msg.sender] = true;
        if (lockedUntil[msg.sender] < p.end) lockedUntil[msg.sender] = p.end;
        uint32 here = localEid();
        emit VoteCast(id, msg.sender, support, weight, here);
        if (here == hubEid) {
            _tally(id, msg.sender, support, weight, here);
            _refund(msg.value);
        } else {
            bytes memory payload = abi.encode(VOTE, abi.encode(id, msg.sender, support, weight));
            _lzSend(hubEid, payload, enforcedOptions(hubEid, VOTE), MessagingFee(msg.value, 0), msg.sender);
        }
    }

    function quoteVote(uint256 id, uint8 support, address voter) external view returns (uint256) {
        if (localEid() == hubEid) return 0;
        bytes memory payload = abi.encode(VOTE, abi.encode(id, voter, support, staked[voter]));
        return _quote(hubEid, payload, enforcedOptions(hubEid, VOTE), false).nativeFee;
    }

    function quotePropose(uint32[] calldata dstEids) external view returns (uint256 total) {
        bytes memory payload = abi.encode(PROPOSE, abi.encode(type(uint256).max, uint64(0), uint64(0)));
        for (uint256 i; i < dstEids.length; ++i) total += _quote(dstEids[i], payload, enforcedOptions(dstEids[i], PROPOSE), false).nativeFee;
    }

    function localEid() public view returns (uint32) {
        return endpoint.eid();
    }

    // ───────────────────────── internals ─────────────────────────

    function _lzReceive(Origin calldata origin, bytes32, bytes calldata message, address, bytes calldata) internal override {
        (uint16 kind, bytes memory body) = abi.decode(message, (uint16, bytes));
        if (kind == PROPOSE) {
            (uint256 id, uint64 start, uint64 end) = abi.decode(body, (uint256, uint64, uint64));
            proposals[id] = Proposal(start, end, 0, 0, 0);
            emit ProposalMirrored(id, start, end, origin.srcEid);
        } else {
            // cast before the window closed on the spoke, so a slow delivery still counts
            _receiveVote(body, origin.srcEid);
        }
    }

    function _receiveVote(bytes memory body, uint32 srcEid) private {
        (uint256 id, address voter, uint8 support, uint256 weight) = abi.decode(body, (uint256, address, uint8, uint256));
        _tally(id, voter, support, weight, srcEid);
    }

    function _tally(uint256 id, address voter, uint8 support, uint256 weight, uint32 srcEid) private {
        Proposal storage p = proposals[id];
        uint128 w = uint128(weight);
        if (support == 1) p.forVotes += w;
        else if (support == 0) p.againstVotes += w;
        else p.abstainVotes += w;
        emit VoteTallied(id, voter, support, weight, srcEid);
    }

    function _refund(uint256 amount) private {
        if (amount > 0) {
            (bool ok, ) = msg.sender.call{ value: amount }("");
            ok;
        }
    }

    // propose() fans out several sends from one msg.value and checks the running total itself
    function _payNative(uint256 nativeFee) internal view override returns (uint256) {
        if (msg.value < nativeFee) revert FeeTooLow(nativeFee);
        return nativeFee;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
