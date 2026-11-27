// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { OmnitideOracle } from "./OmnitideOracle.sol";
import { OmnitideClearinghouse } from "./OmnitideClearinghouse.sol";

interface IWETH {
    function deposit() external payable;
}

/// @title OmnitideLending (ltdUSD)
/// @notice Lenders supply tdUSD and hold ltdUSD shares that grow with interest. Borrowers lock ETH (WETH) and borrow tdUSD
///         against it, to a wallet or straight into their clearinghouse margin. Positions over the liquidation threshold are
///         repaid by anyone for the collateral plus a bonus; debt left with no collateral is written off against lenders.
contract OmnitideLending is ERC4626Upgradeable, Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    struct Params {
        uint16 ltvBps; // borrow up to this share of collateral value
        uint16 liquidationBps; // liquidatable once debt passes this share
        uint16 bonusBps; // liquidator's extra collateral
        uint16 reserveBps; // share of interest sent to the Tide Pool
        uint16 closeFactorBps; // share of debt one liquidation may repay
        uint64 baseRate; // APR at 0% utilisation, WAD
        uint64 kinkRate; // APR at the kink, WAD
        uint64 maxRate; // APR at 100% utilisation, WAD
        uint16 kinkBps; // utilisation where the steep slope starts
        uint256 supplyCap; // tdUSD units, cap on total supplied
        uint256 borrowCap; // tdUSD units, cap on total borrowed
        uint256 dustDebt; // tdUSD units: debt at or below this may be liquidated in full
    }

    struct Account {
        uint256 collateral; // WETH, 18 decimals
        uint256 debtScaled; // debt / borrowIndex, WAD
    }

    IERC20 public collateralToken;
    bytes32 public collateralFeed;
    OmnitideOracle public oracle;
    OmnitideClearinghouse public clearinghouse;
    address public guardian;

    Params public params;
    uint256 public borrowIndex; // WAD, grows with interest
    uint256 public totalDebtScaled;
    uint256 public reserves; // tdUSD units owed to the Tide Pool
    uint64 public lastAccrual;
    uint256 public totalCollateral;

    mapping(address => Account) public accounts;

    event ParamsSet(Params p);
    event Accrued(uint256 borrowIndex, uint256 interest, uint256 toReserves);
    event CollateralDeposited(address indexed account, address indexed from, uint256 amount);
    event CollateralWithdrawn(address indexed account, address receiver, uint256 amount);
    event Borrowed(address indexed account, address receiver, uint256 amount, bool toMargin);
    event Repaid(address indexed account, address indexed from, uint256 amount);
    event Liquidated(address indexed account, address indexed liquidator, uint256 repaid, uint256 seized, uint256 price);
    event BadDebt(address indexed account, uint256 amount);
    event ReservesSent(uint256 amount);

    error NotGuardian();
    error ZeroAddress();
    error ZeroAmount();
    error BadParams();
    error WrongFeed(bytes32 feed);
    error CapReached(uint256 cap);
    error NoLiquidity(uint256 cash, uint256 amount);
    error Unhealthy(uint256 debt, uint256 limit);
    error Healthy(uint256 debt, uint256 limit);
    error TooMuchRepaid(uint256 max);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address guardian_,
        OmnitideClearinghouse clearinghouse_,
        IERC20 collateral_,
        bytes32 feed_,
        Params calldata p
    ) external initializer {
        if (guardian_ == address(0) || address(clearinghouse_) == address(0) || address(collateral_) == address(0)) revert ZeroAddress();
        __ERC20_init("Lending tdUSD", "ltdUSD");
        __ERC4626_init(clearinghouse_.token());
        __Ownable_init(owner_);
        __Pausable_init();
        clearinghouse = clearinghouse_;
        oracle = clearinghouse_.oracle();
        collateralToken = collateral_;
        collateralFeed = feed_;
        guardian = guardian_;
        borrowIndex = WAD;
        lastAccrual = uint64(block.timestamp);
        _setParams(p);
    }

    // ───────────────────────── admin ─────────────────────────

    function setParams(Params calldata p) external onlyOwner {
        accrue();
        _setParams(p);
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _setParams(Params calldata p) private {
        if (
            p.ltvBps == 0 ||
            p.ltvBps >= p.liquidationBps ||
            // the bonus must fit inside the collateral cushion, or every liquidation would leave bad debt
            (uint256(p.liquidationBps) * (BPS + p.bonusBps)) / BPS >= BPS ||
            p.reserveBps > 5_000 ||
            p.closeFactorBps == 0 ||
            p.closeFactorBps > BPS ||
            p.kinkBps == 0 ||
            p.kinkBps >= BPS ||
            p.baseRate > p.kinkRate ||
            p.kinkRate > p.maxRate ||
            p.maxRate > 10 * WAD
        ) revert BadParams();
        params = p;
        emit ParamsSet(p);
    }

    // ───────────────────────── interest ─────────────────────────

    /// @notice Borrow APR (WAD) at a utilisation in bps: flat-ish up to the kink, steep after it so lenders can always exit.
    function borrowRate(uint256 utilBps) public view returns (uint256) {
        Params memory p = params;
        if (utilBps <= p.kinkBps) return p.baseRate + ((uint256(p.kinkRate) - p.baseRate) * utilBps) / p.kinkBps;
        return p.kinkRate + ((uint256(p.maxRate) - p.kinkRate) * (utilBps - p.kinkBps)) / (BPS - p.kinkBps);
    }

    function totalDebt() public view returns (uint256) {
        (uint256 index, , ) = _pending();
        return _debtOf(totalDebtScaled, index);
    }

    function cash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function utilization() public view returns (uint256) {
        uint256 debt = totalDebt();
        uint256 supplied = debt + cash() - _min(cash(), _pendingReserves());
        return supplied == 0 ? 0 : (debt * BPS) / supplied;
    }

    /// @notice Lender APR (WAD) at the current utilisation, after the reserve cut.
    function supplyRate() external view returns (uint256) {
        uint256 u = utilization();
        return (borrowRate(u) * u * (BPS - params.reserveBps)) / BPS / BPS;
    }

    function accrue() public {
        (uint256 index, uint256 interest, uint256 toReserves) = _pending();
        if (block.timestamp == lastAccrual) return;
        lastAccrual = uint64(block.timestamp);
        if (index == borrowIndex) return;
        borrowIndex = index;
        reserves += toReserves;
        emit Accrued(index, interest, toReserves);
    }

    function _pending() private view returns (uint256 index, uint256 interest, uint256 toReserves) {
        index = borrowIndex;
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0 || totalDebtScaled == 0) return (index, 0, 0);
        uint256 debt = _debtOf(totalDebtScaled, index);
        uint256 supplied = debt + cash() - _min(cash(), reserves);
        uint256 util = supplied == 0 ? 0 : (debt * BPS) / supplied;
        uint256 growth = (borrowRate(util) * dt) / YEAR; // simple interest between accruals, WAD
        index += (index * growth) / WAD;
        interest = _debtOf(totalDebtScaled, index) - debt;
        toReserves = (interest * params.reserveBps) / BPS;
    }

    function _pendingReserves() private view returns (uint256) {
        (, , uint256 toReserves) = _pending();
        return reserves + toReserves;
    }

    /// @notice Sends accrued reserves to the Tide Pool, which Harbor owns. Anyone may call it.
    function sendReserves() external nonReentrant {
        accrue();
        uint256 amount = _min(reserves, cash());
        if (amount == 0) revert ZeroAmount();
        reserves -= amount;
        IERC20(asset()).forceApprove(address(clearinghouse), amount);
        clearinghouse.fundPool(amount);
        emit ReservesSent(amount);
    }

    // ───────────────────────── lenders (ERC-4626) ─────────────────────────

    /// @notice Cash plus what borrowers owe, minus the reserve cut.
    function totalAssets() public view override returns (uint256) {
        return cash() + totalDebt() - _min(cash() + totalDebt(), _pendingReserves());
    }

    function maxDeposit(address) public view override returns (uint256) {
        uint256 assets = totalAssets();
        return paused() || assets >= params.supplyCap ? 0 : params.supplyCap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    /// @notice Lenders exit from idle cash only; what is lent out comes back as borrowers repay.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return _min(super.maxWithdraw(owner_), _freeCash());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return _min(super.maxRedeem(owner_), convertToShares(_freeCash()));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        accrue();
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares) internal override nonReentrant {
        accrue();
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    function _freeCash() private view returns (uint256) {
        uint256 c = cash();
        uint256 r = _pendingReserves();
        return c > r ? c - r : 0;
    }

    /// @dev Virtual shares make a first-deposit share-price attack cost a million times the profit.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ───────────────────────── borrowers ─────────────────────────

    /// @notice Lock WETH for `account`. Anyone may add collateral for anyone (e.g. an Inlet delivering it).
    function depositCollateral(uint256 amount, address account) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        _addCollateral(account, amount);
    }

    /// @notice Lock native ETH, wrapped to WETH on the way in.
    function depositETH(address account) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        IWETH(address(collateralToken)).deposit{ value: msg.value }();
        _addCollateral(account, msg.value);
    }

    function withdrawCollateral(uint256 amount, address receiver, OmnitideOracle.PriceReport calldata report) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        accrue();
        Account storage a = accounts[msg.sender];
        a.collateral -= amount;
        totalCollateral -= amount;
        if (a.debtScaled > 0) _requireHealthy(msg.sender, _price(report), params.ltvBps);
        collateralToken.safeTransfer(receiver, amount);
        emit CollateralWithdrawn(msg.sender, receiver, amount);
    }

    /// @notice Borrow tdUSD to `receiver`.
    function borrow(uint256 amount, address receiver, OmnitideOracle.PriceReport calldata report) external nonReentrant whenNotPaused {
        if (receiver == address(0)) revert ZeroAddress();
        _borrow(amount, report);
        IERC20(asset()).safeTransfer(receiver, amount);
        emit Borrowed(msg.sender, receiver, amount, false);
    }

    /// @notice Borrow tdUSD straight into the caller's clearinghouse margin.
    function borrowToMargin(uint256 amount, OmnitideOracle.PriceReport calldata report) external nonReentrant whenNotPaused {
        _borrow(amount, report);
        IERC20(asset()).forceApprove(address(clearinghouse), amount);
        clearinghouse.depositFor(msg.sender, amount);
        emit Borrowed(msg.sender, address(clearinghouse), amount, true);
    }

    /// @notice Repay `account`'s debt; type(uint256).max repays all of it. Open while paused, and anyone may repay for anyone.
    function repay(uint256 amount, address account) external nonReentrant returns (uint256 repaid) {
        accrue();
        uint256 debt = debtOf(account);
        repaid = _min(amount, debt);
        if (repaid == 0) revert ZeroAmount();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), repaid);
        _reduceDebt(account, repaid, debt);
        emit Repaid(account, msg.sender, repaid);
    }

    /// @notice Repay part of an unhealthy position and take its collateral at `bonusBps` over the oracle price.
    function liquidate(address account, uint256 repayAmount, address receiver, OmnitideOracle.PriceReport calldata report)
        external
        nonReentrant
        returns (uint256 seized)
    {
        accrue();
        uint256 price = _price(report);
        uint256 debt = debtOf(account);
        uint256 limit = _limit(accounts[account].collateral, price, params.liquidationBps);
        if (debt <= limit) revert Healthy(debt, limit);

        uint256 maxRepay = debt <= params.dustDebt ? debt : (debt * params.closeFactorBps) / BPS;
        if (repayAmount == type(uint256).max) repayAmount = maxRepay;
        if (repayAmount == 0) revert ZeroAmount();
        if (repayAmount > maxRepay) revert TooMuchRepaid(maxRepay);

        Account storage a = accounts[account];
        seized = _toCollateral((repayAmount * (BPS + params.bonusBps)) / BPS, price);
        if (seized > a.collateral) {
            // not enough collateral for the bonus: take all of it for the share of debt it covers
            seized = a.collateral;
            repayAmount = _min(repayAmount, _value(seized, price).mulDiv(BPS, BPS + params.bonusBps, Math.Rounding.Ceil));
        }
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), repayAmount);
        _reduceDebt(account, repayAmount, debt);
        a.collateral -= seized;
        totalCollateral -= seized;
        collateralToken.safeTransfer(receiver, seized);
        emit Liquidated(account, msg.sender, repayAmount, seized, price);

        // no collateral left: the rest of the debt is a loss lenders share through the share price
        if (a.collateral == 0 && a.debtScaled > 0) {
            uint256 left = debtOf(account);
            totalDebtScaled -= a.debtScaled;
            a.debtScaled = 0;
            emit BadDebt(account, left);
        }
    }

    // ───────────────────────── views ─────────────────────────

    function debtOf(address account) public view returns (uint256) {
        (uint256 index, , ) = _pending();
        return _debtOf(accounts[account].debtScaled, index);
    }

    /// @notice Collateral, debt and the two limits at `price` (1e18 USD per ETH); health is liquidation limit over debt, WAD.
    function positionOf(address account, uint256 price)
        external
        view
        returns (uint256 collateral, uint256 debt, uint256 borrowLimit, uint256 liquidationLimit, uint256 health)
    {
        collateral = accounts[account].collateral;
        debt = debtOf(account);
        borrowLimit = _limit(collateral, price, params.ltvBps);
        liquidationLimit = _limit(collateral, price, params.liquidationBps);
        health = debt == 0 ? type(uint256).max : (liquidationLimit * WAD) / debt;
    }

    // ───────────────────────── internals ─────────────────────────

    function _borrow(uint256 amount, OmnitideOracle.PriceReport calldata report) private {
        if (amount == 0) revert ZeroAmount();
        accrue();
        uint256 debtBefore = _debtOf(totalDebtScaled, borrowIndex);
        if (debtBefore + amount > params.borrowCap) revert CapReached(params.borrowCap);
        uint256 free = _freeCash();
        if (amount > free) revert NoLiquidity(free, amount);
        uint256 scaled = amount.mulDiv(WAD, borrowIndex, Math.Rounding.Ceil);
        accounts[msg.sender].debtScaled += scaled;
        totalDebtScaled += scaled;
        _requireHealthy(msg.sender, _price(report), params.ltvBps);
    }

    function _reduceDebt(address account, uint256 repaid, uint256 debt) private {
        Account storage a = accounts[account];
        uint256 scaled = repaid == debt ? a.debtScaled : _min(a.debtScaled, repaid.mulDiv(WAD, borrowIndex));
        a.debtScaled -= scaled;
        totalDebtScaled -= _min(totalDebtScaled, scaled);
    }

    function _addCollateral(address account, uint256 amount) private {
        if (account == address(0)) revert ZeroAddress();
        accounts[account].collateral += amount;
        totalCollateral += amount;
        emit CollateralDeposited(account, msg.sender, amount);
    }

    function _requireHealthy(address account, uint256 price, uint16 bps) private view {
        uint256 debt = _debtOf(accounts[account].debtScaled, borrowIndex);
        uint256 limit = _limit(accounts[account].collateral, price, bps);
        if (debt > limit) revert Unhealthy(debt, limit);
    }

    function _price(OmnitideOracle.PriceReport calldata report) private view returns (uint256) {
        if (report.feed != collateralFeed) revert WrongFeed(report.feed);
        return oracle.verify(report);
    }

    /// @dev Debt rounds up so the protocol never under-counts what it is owed.
    function _debtOf(uint256 scaled, uint256 index) private pure returns (uint256) {
        return scaled.mulDiv(index, WAD, Math.Rounding.Ceil);
    }

    /// @dev Collateral (1e18) at `price` (1e18 USD) in tdUSD units (1e6).
    function _value(uint256 collateral, uint256 price) private pure returns (uint256) {
        return collateral.mulDiv(price, 1e30);
    }

    function _toCollateral(uint256 usd, uint256 price) private pure returns (uint256) {
        return usd.mulDiv(1e30, price);
    }

    function _limit(uint256 collateral, uint256 price, uint16 bps) private pure returns (uint256) {
        return (_value(collateral, price) * bps) / BPS;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
