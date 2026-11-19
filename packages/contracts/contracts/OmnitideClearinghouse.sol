// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IOAppComposer } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm/contracts/libs/OFTComposeMsgCodec.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { OmnitideOracle } from "./OmnitideOracle.sol";

interface IEndpointEid {
    function eid() external view returns (uint32);
}

interface IOAppEndpoint {
    function endpoint() external view returns (address);
}

/// @title OmnitideClearinghouse
/// @notice One cross-margined book on the hub: collateral, perps, conditional orders and liquidations.
contract OmnitideClearinghouse is
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    IOAppComposer
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    enum OrderKind {
        Limit,
        StopLoss,
        TakeProfit
    }

    struct Market {
        bytes32 feed;
        uint16 initialMarginBps;
        uint16 maintenanceMarginBps;
        bool active;
        uint256 maxOpenInterestUsd; // 1e18
        uint256 longSize; // base, 1e18
        uint256 shortSize; // base, 1e18
    }

    struct Position {
        int256 size; // base units, 1e18, signed
        uint256 entryPrice; // USD, 1e18
    }

    struct Order {
        address account;
        uint8 marketId;
        OrderKind kind;
        bool reduceOnly;
        bool active;
        int256 sizeDelta;
        uint256 triggerPrice;
    }

    uint256 private constant TO_WAD = 1e12; // tdUSD has 6 decimals
    uint256 public constant MAX_POSITIONS = 8;
    uint256 public constant MAX_ORDERS = 16;
    uint256 public constant LIQUIDATION_PENALTY_BPS = 100;
    uint256 public constant LIQUIDATOR_SHARE_BPS = 2_000;

    IERC20 public token;
    OmnitideOracle public oracle;
    address public endpoint;
    uint32 public hubEid;
    address public guardian;

    uint16 public feeBps;
    uint256 public depositCap; // tdUSD units, total across local deposits
    uint256 public totalCollateral; // tdUSD units, sum of positive account balances credited
    int256 public poolBalance; // tdUSD units, counterparty liquidity

    uint8 public marketCount;
    mapping(uint8 => Market) public markets;

    mapping(address => int256) public balances; // tdUSD units
    mapping(address => mapping(uint8 => Position)) public positions;
    mapping(address => uint8[]) private _openMarkets;

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public openOrderCount;

    address public harbor; // Harbor vault: owns the Tide Pool once set

    event Deposited(address indexed account, uint256 amount, uint32 srcEid, bytes32 guid);
    event Withdrawn(address indexed account, uint256 amount, uint32 dstEid, address receiver, bytes32 guid);
    event Traded(
        address indexed account,
        uint8 indexed marketId,
        int256 sizeDelta,
        uint256 price,
        int256 newSize,
        uint256 entryPrice,
        int256 realizedPnl,
        uint256 fee
    );
    event OrderPlaced(
        uint256 indexed id,
        address indexed account,
        uint8 indexed marketId,
        OrderKind kind,
        int256 sizeDelta,
        uint256 triggerPrice,
        bool reduceOnly
    );
    event OrderCancelled(uint256 indexed id, address indexed account);
    event OrderExecuted(uint256 indexed id, address indexed account, uint256 price, address executor);
    event Liquidated(address indexed account, address indexed liquidator, uint256 notional, uint256 penalty, uint256 badDebt);
    event PoolFunded(address indexed from, int256 amount);
    event MarketSet(uint8 indexed id, bytes32 feed, uint16 initialMarginBps, uint16 maintenanceMarginBps, uint256 maxOpenInterestUsd, bool active);
    event ParamsSet(uint16 feeBps, uint256 depositCap, address guardian);
    event HarborSet(address harbor);

    error NotGuardian();
    error NotEndpoint();
    error UnknownMarket(uint8 id);
    error MarketInactive(uint8 id);
    error MissingPrice(bytes32 feed);
    error SlippageExceeded(uint256 price, uint256 limit);
    error InsufficientMargin(int256 equity, uint256 required);
    error InsufficientBalance(int256 balance, uint256 amount);
    error DepositCapReached(uint256 cap);
    error TooManyPositions();
    error TooManyOrders();
    error OpenInterestCap(uint8 id);
    error NotLiquidatable(int256 equity, uint256 maintenance);
    error OrderNotActive(uint256 id);
    error NotOrderOwner(uint256 id);
    error TriggerNotMet(uint256 price, uint256 trigger);
    error ZeroAmount();
    error PausedIncrease();
    error ZeroAddress();
    error NotHarbor();
    error HarborActive();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address guardian_,
        IERC20 token_,
        OmnitideOracle oracle_,
        uint16 feeBps_,
        uint256 depositCap_
    ) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();
        if (guardian_ == address(0)) revert ZeroAddress();
        token = token_;
        oracle = oracle_;
        endpoint = IOAppEndpoint(address(token_)).endpoint();
        hubEid = IEndpointEid(endpoint).eid();
        guardian = guardian_;
        feeBps = feeBps_;
        depositCap = depositCap_;
        emit ParamsSet(feeBps_, depositCap_, guardian_);
    }

    // ───────────────────────── admin ─────────────────────────

    function setMarket(
        uint8 id,
        bytes32 feed,
        uint16 initialMarginBps,
        uint16 maintenanceMarginBps,
        uint256 maxOpenInterestUsd,
        bool active
    ) external onlyOwner {
        require(id <= marketCount, "gap");
        require(maintenanceMarginBps > 0 && maintenanceMarginBps < initialMarginBps && initialMarginBps <= 10_000, "margin");
        Market storage m = markets[id];
        m.feed = feed;
        m.initialMarginBps = initialMarginBps;
        m.maintenanceMarginBps = maintenanceMarginBps;
        m.maxOpenInterestUsd = maxOpenInterestUsd;
        m.active = active;
        if (id == marketCount) marketCount++;
        emit MarketSet(id, feed, initialMarginBps, maintenanceMarginBps, maxOpenInterestUsd, active);
    }

    function setParams(uint16 feeBps_, uint256 depositCap_, address guardian_) external onlyOwner {
        require(feeBps_ <= 100, "fee");
        if (guardian_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        depositCap = depositCap_;
        guardian = guardian_;
        emit ParamsSet(feeBps_, depositCap_, guardian_);
    }

    /// @notice Adds counterparty liquidity to the Tide Pool.
    function fundPool(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount.toInt256();
        emit PoolFunded(msg.sender, amount.toInt256());
    }

    /// @notice Owner withdraws pool liquidity that is not owed to anyone; closed for good once Harbor owns the pool.
    function defundPool(uint256 amount, address to) external onlyOwner {
        if (harbor != address(0)) revert HarborActive();
        _drawPool(amount, to);
    }

    /// @notice Hands the Tide Pool to the Harbor vault, which then is the only account able to draw from it.
    function setHarbor(address harbor_) external onlyOwner {
        if (harbor_ == address(0)) revert ZeroAddress();
        harbor = harbor_;
        emit HarborSet(harbor_);
    }

    /// @notice Harbor redemptions are paid out of the Tide Pool.
    function drawPool(uint256 amount, address to) external {
        if (msg.sender != harbor) revert NotHarbor();
        _drawPool(amount, to);
    }

    function _drawPool(uint256 amount, address to) private {
        require(poolBalance >= amount.toInt256(), "pool");
        poolBalance -= amount.toInt256();
        token.safeTransfer(to, amount);
        emit PoolFunded(to, -amount.toInt256());
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────────────────────── collateral ─────────────────────────

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (totalCollateral + amount > depositCap) revert DepositCapReached(depositCap);
        token.safeTransferFrom(msg.sender, address(this), amount);
        _credit(msg.sender, amount);
        emit Deposited(msg.sender, amount, hubEid, bytes32(0));
    }

    /// @notice Inflow: tdUSD arriving from a spoke through LayerZero is credited to the sender's book.
    function lzCompose(address from, bytes32 guid, bytes calldata message, address, bytes calldata) external payable {
        if (msg.sender != endpoint) revert NotEndpoint();
        if (from != address(token)) revert NotEndpoint();
        uint256 amount = OFTComposeMsgCodec.amountLD(message);
        bytes memory inner = OFTComposeMsgCodec.composeMsg(message);
        address account = inner.length == 32
            ? abi.decode(inner, (address))
            : OFTComposeMsgCodec.bytes32ToAddress(OFTComposeMsgCodec.composeFrom(message));
        // never revert here: funds already sit in this contract; pathway rate limits bound inflow
        _credit(account, amount);
        emit Deposited(account, amount, OFTComposeMsgCodec.srcEid(message), guid);
    }

    /// @notice Ebb: withdraw to this chain (dstEid == hubEid) or to any spoke through LayerZero.
    function withdraw(
        uint256 amount,
        uint32 dstEid,
        address receiver,
        OmnitideOracle.PriceReport[] calldata reports
    ) external payable nonReentrant returns (bytes32 guid) {
        if (amount == 0) revert ZeroAmount();
        int256 bal = balances[msg.sender];
        if (bal < amount.toInt256()) revert InsufficientBalance(bal, amount);
        _debit(msg.sender, amount);
        if (_openMarkets[msg.sender].length > 0) _requireMargin(msg.sender, reports, true);

        if (dstEid == hubEid) {
            token.safeTransfer(receiver, amount);
        } else {
            SendParam memory p = SendParam({
                dstEid: dstEid,
                to: OFTComposeMsgCodec.addressToBytes32(receiver),
                amountLD: amount,
                minAmountLD: amount,
                extraOptions: "",
                composeMsg: "",
                oftCmd: ""
            });
            (guid, ) = _sendOft(p, msg.value);
        }
        emit Withdrawn(msg.sender, amount, dstEid, receiver, guid);
    }

    function _sendOft(SendParam memory p, uint256 nativeFee) private returns (bytes32 guid, uint64 nonce) {
        (bool ok, bytes memory ret) = address(token).call{ value: nativeFee }(
            abi.encodeCall(IOFT.send, (p, MessagingFee(nativeFee, 0), msg.sender))
        );
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        (guid, nonce) = abi.decode(ret, (bytes32, uint64));
    }

    // ───────────────────────── trading ─────────────────────────

    function trade(
        uint8 marketId,
        int256 sizeDelta,
        uint256 priceLimit,
        OmnitideOracle.PriceReport[] calldata reports
    ) external nonReentrant {
        uint256 price = _priceOf(reports, _market(marketId).feed);
        if (sizeDelta > 0 ? price > priceLimit : price < priceLimit) revert SlippageExceeded(price, priceLimit);
        _execute(msg.sender, marketId, sizeDelta, price, reports);
    }

    function placeOrder(
        uint8 marketId,
        OrderKind kind,
        int256 sizeDelta,
        uint256 triggerPrice,
        bool reduceOnly
    ) external returns (uint256 id) {
        if (!reduceOnly && paused()) revert PausedIncrease();
        if (!_market(marketId).active) revert MarketInactive(marketId);
        if (sizeDelta == 0 || triggerPrice == 0) revert ZeroAmount();
        if (openOrderCount[msg.sender] >= MAX_ORDERS) revert TooManyOrders();
        id = nextOrderId++;
        orders[id] = Order(msg.sender, marketId, kind, reduceOnly || kind != OrderKind.Limit, true, sizeDelta, triggerPrice);
        openOrderCount[msg.sender]++;
        emit OrderPlaced(id, msg.sender, marketId, kind, sizeDelta, triggerPrice, orders[id].reduceOnly);
    }

    function cancelOrder(uint256 id) external {
        Order storage o = orders[id];
        if (!o.active) revert OrderNotActive(id);
        if (o.account != msg.sender) revert NotOrderOwner(id);
        _closeOrder(id, o.account);
        emit OrderCancelled(id, msg.sender);
    }

    /// @notice Anyone (normally the keeper) fills a resting order once its trigger is met.
    function executeOrder(uint256 id, OmnitideOracle.PriceReport[] calldata reports) external nonReentrant {
        Order memory o = orders[id];
        if (!o.active) revert OrderNotActive(id);
        uint256 price = _priceOf(reports, _market(o.marketId).feed);
        bool buy = o.sizeDelta > 0;
        bool met = o.kind == OrderKind.StopLoss
            ? (buy ? price >= o.triggerPrice : price <= o.triggerPrice)
            : (buy ? price <= o.triggerPrice : price >= o.triggerPrice);
        if (!met) revert TriggerNotMet(price, o.triggerPrice);

        int256 delta = o.sizeDelta;
        if (o.reduceOnly) delta = _clampReduce(positions[o.account][o.marketId].size, delta);
        _closeOrder(id, o.account);
        if (delta != 0) _execute(o.account, o.marketId, delta, price, reports);
        emit OrderExecuted(id, o.account, price, msg.sender);
    }

    function liquidate(address account, OmnitideOracle.PriceReport[] calldata reports) external nonReentrant {
        (int256 equity, , uint256 maintenance) = _accountMargin(account, reports);
        if (equity >= maintenance.toInt256()) revert NotLiquidatable(equity, maintenance);

        uint8[] memory open = _openMarkets[account];
        uint256 notional;
        for (uint256 i; i < open.length; ++i) {
            uint8 id = open[i];
            int256 size = positions[account][id].size;
            uint256 price = _priceOf(reports, markets[id].feed);
            notional += _abs(size) * price / 1e18;
            _applyFill(account, id, -size, price, 0);
        }

        uint256 penalty = notional * LIQUIDATION_PENALTY_BPS / 10_000 / TO_WAD;
        int256 bal = balances[account];
        uint256 paid = bal > 0 ? _min(uint256(bal), penalty) : 0;
        uint256 reward = paid * LIQUIDATOR_SHARE_BPS / 10_000;
        _debit(account, paid);
        poolBalance += (paid - reward).toInt256();
        _credit(msg.sender, reward);

        uint256 badDebt;
        if (balances[account] < 0) {
            badDebt = uint256(-balances[account]);
            balances[account] = 0;
            poolBalance -= badDebt.toInt256();
        }
        emit Liquidated(account, msg.sender, notional, paid, badDebt);
    }

    // ───────────────────────── views ─────────────────────────

    function openMarkets(address account) external view returns (uint8[] memory) {
        return _openMarkets[account];
    }

    /// @notice Equity, initial and maintenance margin (all 1e18 USD) at the supplied prices.
    function accountMargin(
        address account,
        OmnitideOracle.PriceReport[] calldata reports
    ) external view returns (int256 equity, uint256 initialMargin, uint256 maintenanceMargin) {
        return _accountMargin(account, reports);
    }

    // ───────────────────────── internals ─────────────────────────

    function _execute(
        address account,
        uint8 marketId,
        int256 sizeDelta,
        uint256 price,
        OmnitideOracle.PriceReport[] calldata reports
    ) private {
        if (sizeDelta == 0) revert ZeroAmount();
        Market storage m = _market(marketId);
        int256 before = positions[account][marketId].size;
        int256 next = before + sizeDelta;
        bool flips = before != 0 && next != 0 && (before > 0) != (next > 0);
        bool increases = flips || _abs(next) > _abs(before);
        if (increases) {
            if (paused()) revert PausedIncrease();
            if (!m.active) revert MarketInactive(marketId);
        }
        uint256 fee = _abs(sizeDelta) * price * feeBps / 1e18 / 10_000 / TO_WAD;
        _applyFill(account, marketId, sizeDelta, price, fee);
        if (increases) {
            if (_openMarkets[account].length > MAX_POSITIONS) revert TooManyPositions();
            if ((m.longSize > m.shortSize ? m.longSize : m.shortSize) * price / 1e18 > m.maxOpenInterestUsd) revert OpenInterestCap(marketId);
            _requireMargin(account, reports, true);
        }
    }

    function _applyFill(address account, uint8 marketId, int256 sizeDelta, uint256 price, uint256 fee) private {
        Market storage m = markets[marketId];
        Position storage p = positions[account][marketId];
        int256 oldSize = p.size;
        int256 newSize = oldSize + sizeDelta;
        int256 pnl;

        if (oldSize == 0 || (oldSize > 0) == (sizeDelta > 0)) {
            p.entryPrice = (_abs(oldSize) * p.entryPrice + _abs(sizeDelta) * price) / _abs(newSize);
        } else {
            uint256 closed = _min(_abs(oldSize), _abs(sizeDelta));
            int256 move = price.toInt256() - p.entryPrice.toInt256();
            pnl = (oldSize > 0 ? move : -move) * closed.toInt256() / 1e18;
            if (newSize != 0 && (newSize > 0) != (oldSize > 0)) p.entryPrice = price;
        }

        _updateOpenInterest(m, oldSize, newSize);
        if (oldSize == 0 && newSize != 0) _openMarkets[account].push(marketId);
        if (newSize == 0) {
            p.entryPrice = 0;
            _removeOpen(account, marketId);
        }
        p.size = newSize;

        int256 pnlUnits = pnl / int256(TO_WAD);
        int256 delta = pnlUnits - fee.toInt256();
        balances[account] += delta;
        if (delta > 0) totalCollateral += uint256(delta);
        else totalCollateral -= _min(totalCollateral, uint256(-delta));
        poolBalance -= delta;
        emit Traded(account, marketId, sizeDelta, price, newSize, p.entryPrice, pnlUnits, fee);
    }

    function _updateOpenInterest(Market storage m, int256 oldSize, int256 newSize) private {
        if (oldSize > 0) m.longSize -= uint256(oldSize);
        else m.shortSize -= uint256(-oldSize);
        if (newSize > 0) m.longSize += uint256(newSize);
        else m.shortSize += uint256(-newSize);
    }

    function _requireMargin(address account, OmnitideOracle.PriceReport[] calldata reports, bool initial) private view {
        (int256 equity, uint256 im, uint256 mm) = _accountMargin(account, reports);
        uint256 required = initial ? im : mm;
        if (equity < required.toInt256()) revert InsufficientMargin(equity, required);
    }

    function _accountMargin(
        address account,
        OmnitideOracle.PriceReport[] calldata reports
    ) private view returns (int256 equity, uint256 im, uint256 mm) {
        equity = balances[account] * int256(TO_WAD);
        uint8[] memory open = _openMarkets[account];
        for (uint256 i; i < open.length; ++i) {
            Market storage m = markets[open[i]];
            Position memory p = positions[account][open[i]];
            uint256 price = _priceOf(reports, m.feed);
            equity += p.size * (price.toInt256() - p.entryPrice.toInt256()) / 1e18;
            uint256 notional = _abs(p.size) * price / 1e18;
            im += notional * m.initialMarginBps / 10_000;
            mm += notional * m.maintenanceMarginBps / 10_000;
        }
    }

    function _priceOf(OmnitideOracle.PriceReport[] calldata reports, bytes32 feed) private view returns (uint256) {
        for (uint256 i; i < reports.length; ++i) {
            if (reports[i].feed == feed) return oracle.verify(reports[i]);
        }
        revert MissingPrice(feed);
    }

    function _market(uint8 id) private view returns (Market storage m) {
        if (id >= marketCount) revert UnknownMarket(id);
        m = markets[id];
    }

    function _clampReduce(int256 size, int256 delta) private pure returns (int256) {
        if (size == 0 || (size > 0) == (delta > 0)) return 0;
        return _abs(delta) > _abs(size) ? -size : delta;
    }

    function _closeOrder(uint256 id, address account) private {
        orders[id].active = false;
        openOrderCount[account]--;
    }

    function _removeOpen(address account, uint8 marketId) private {
        uint8[] storage list = _openMarkets[account];
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == marketId) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }

    function _credit(address account, uint256 amount) private {
        balances[account] += amount.toInt256();
        totalCollateral += amount;
    }

    function _debit(address account, uint256 amount) private {
        balances[account] -= amount.toInt256();
        totalCollateral -= _min(totalCollateral, amount);
    }

    function _abs(int256 x) private pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
