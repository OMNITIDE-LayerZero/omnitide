// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OAppUpgradeable, Origin, MessagingFee, MessagingReceipt } from "@layerzerolabs/oapp-evm-upgradeable/contracts/oapp/OAppUpgradeable.sol";
import { ReadCodecV1, EVMCallRequestV1 } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/ReadCodecV1.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title OmnitideTideReader
/// @notice Tide Chart source: one lzRead pulls tdUSD supply from every readable chain in a single DVN-verified answer.
contract OmnitideTideReader is OAppUpgradeable, UUPSUpgradeable {
    using OptionsBuilder for bytes;

    struct Target {
        uint32 eid;
        address token;
    }

    struct Reading {
        uint256 supply;
        uint64 readAt;
    }

    uint32 public constant READ_CHANNEL = 4294967295;
    uint16 public constant SUPPLY_LABEL = 1;
    uint16 public constant CONFIRMATIONS = 2;

    Target[] private _targets;
    mapping(uint32 => Reading) public readings;
    mapping(bytes32 => uint64) public pending; // guid → requested timestamp
    uint128 public readGas;

    event TargetsSet(Target[] targets);
    event TideRequested(bytes32 indexed guid, uint64 readAt, uint256 fee, address indexed by);
    event TideRead(bytes32 indexed guid, uint64 readAt, uint32[] eids, uint256[] supplies);

    error NoTargets();
    error BadResponse(uint256 length);

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(address lzEndpoint) OAppUpgradeable(lzEndpoint) {
        _disableInitializers();
    }

    function initialize(address owner_, Target[] calldata targets_) external initializer {
        __Ownable_init(owner_);
        __OApp_init(owner_);
        _getOAppCoreStorage().peers[READ_CHANNEL] = bytes32(uint256(uint160(address(this)))); // lzRead answers come back from this app itself
        readGas = 120_000;
        _setTargets(targets_);
    }

    function setTargets(Target[] calldata targets_) external onlyOwner {
        _setTargets(targets_);
    }

    function setReadGas(uint128 gas) external onlyOwner {
        readGas = gas;
    }

    function targets() external view returns (Target[] memory) {
        return _targets;
    }

    /// @notice The lzRead command: totalSupply() on every target at `readAt`.
    function command(uint64 readAt) public view returns (bytes memory) {
        uint256 n = _targets.length;
        EVMCallRequestV1[] memory reqs = new EVMCallRequestV1[](n);
        for (uint256 i; i < n; ++i) {
            reqs[i] = EVMCallRequestV1({
                appRequestLabel: uint16(i + 1),
                targetEid: _targets[i].eid,
                isBlockNum: false,
                blockNumOrTimestamp: readAt,
                confirmations: CONFIRMATIONS,
                to: _targets[i].token,
                callData: abi.encodeWithSignature("totalSupply()")
            });
        }
        return ReadCodecV1.encode(SUPPLY_LABEL, reqs);
    }

    function options() public view returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReadOption(readGas, uint32(32 * _targets.length), 0);
    }

    function quote() external view returns (uint256 nativeFee) {
        return _quote(READ_CHANNEL, command(uint64(block.timestamp)), options(), false).nativeFee;
    }

    /// @notice Anyone can pay for a fresh reading; the excess fee is refunded by the endpoint.
    function refresh() external payable returns (bytes32 guid) {
        if (_targets.length == 0) revert NoTargets();
        uint64 readAt = uint64(block.timestamp);
        MessagingReceipt memory r = _lzSend(READ_CHANNEL, command(readAt), options(), MessagingFee(msg.value, 0), payable(msg.sender));
        pending[r.guid] = readAt;
        emit TideRequested(r.guid, readAt, r.fee.nativeFee, msg.sender);
        return r.guid;
    }

    /// @dev Without a compute step the DVNs return each totalSupply word in request order.
    function _lzReceive(Origin calldata, bytes32 guid, bytes calldata message, address, bytes calldata) internal override {
        uint256 n = _targets.length;
        if (message.length != 32 * n) revert BadResponse(message.length);
        uint64 readAt = pending[guid];
        delete pending[guid];
        uint32[] memory eids = new uint32[](n);
        uint256[] memory supplies = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            eids[i] = _targets[i].eid;
            supplies[i] = abi.decode(message[i * 32:(i + 1) * 32], (uint256));
            readings[eids[i]] = Reading(supplies[i], readAt);
        }
        emit TideRead(guid, readAt, eids, supplies);
    }

    function _setTargets(Target[] calldata targets_) private {
        delete _targets;
        for (uint256 i; i < targets_.length; ++i) _targets.push(targets_[i]);
        emit TargetsSet(targets_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
