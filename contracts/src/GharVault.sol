// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title GharVault
/// @notice Holds USDT for senders abroad. Every sender has an isolated balance that only
///         they can fund or withdraw. Agent grants, payee caps and the nominee timer are
///         enforced against these balances.
contract GharVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice A bill as signed by the payee's biller wallet (EIP-712 typed data).
    struct Bill {
        /// ENS namehash of the payee.
        bytes32 payee;
        /// keccak256 of the payee's invoice reference string.
        bytes32 invoiceRef;
        /// USDT base units (6 decimals).
        uint256 amount;
        /// Unix seconds. The bill can be paid up to and including this time.
        uint64 dueDate;
    }

    bytes32 public constant BILL_TYPEHASH =
        keccak256("Bill(bytes32 payee,bytes32 invoiceRef,uint256 amount,uint64 dueDate)");

    /// @notice A spending limit, used both for agent grants and payee caps.
    /// @dev Periods are fixed windows of `period` seconds counted from `periodStart`, so
    ///      spending cannot be shifted by timing calls around a sliding window.
    ///      `period == 0` means the limit is not set.
    struct Limit {
        uint128 perPayment;
        uint128 perPeriod;
        uint64 period;
        uint64 periodStart;
        uint128 spent;
    }

    /// @notice Settlement token (USDT on Whitechain).
    IERC20 public immutable usdt;

    /// @notice Licensed payout provider. Every bill payment goes here and nowhere else, and
    ///         only this address can settle a pending payout.
    /// @dev Immutable on purpose: no admin can redirect funds. A new provider means a new vault.
    address public immutable provider;

    /// @notice How long the provider has to settle a payout before anyone can return the
    ///         USDT to the sender's balance.
    uint256 public constant SETTLE_WINDOW = 1 days;

    /// @notice USDT held for each sender, in token base units.
    mapping(address sender => uint256 amount) public balanceOf;

    /// @notice Spending grant each sender gave each agent.
    mapping(address sender => mapping(address agent => Limit)) public grantOf;

    /// @notice Cap each sender set for each payee, keyed by the payee's ENS namehash.
    mapping(address sender => mapping(bytes32 payee => Limit)) public payeeOf;

    /// @notice Wallet whose signature a payee's bills must carry, copied by the sender from
    ///         the payee's ENS `biller` record. The provider re-checks ENS before paying out.
    mapping(address sender => mapping(bytes32 payee => address)) public billerOf;

    enum PayoutStatus {
        None,
        Pending,
        Paid,
        Refunded
    }

    /// @notice USDT locked for one bill while the provider pays out in local currency.
    struct Payout {
        address sender;
        uint64 requestedAt;
        PayoutStatus status;
        uint256 amount;
    }

    /// @notice Payout for each bill, by EIP-712 digest. Global, so two senders covering the
    ///         same payee cannot both pay one bill. A refunded bill stays used: the biller
    ///         signs a new one to retry.
    mapping(bytes32 digest => Payout) public payoutOf;

    /// @notice Who may take over a sender's balance, and after how long without activity.
    struct Nominee {
        address nominee;
        uint64 delay;
    }

    mapping(address sender => Nominee) public nomineeOf;

    /// @notice Last time each sender acted on the vault themselves.
    mapping(address sender => uint256 timestamp) public lastActive;

    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed sender, address indexed to, uint256 amount);
    event GrantSet(
        address indexed sender,
        address indexed agent,
        uint128 perPayment,
        uint128 perPeriod,
        uint64 period
    );
    event GrantRevoked(address indexed sender, address indexed agent);
    event PayeeSet(
        address indexed sender,
        bytes32 indexed payee,
        address biller,
        uint128 perPayment,
        uint128 perPeriod,
        uint64 period
    );
    event PayeeRemoved(address indexed sender, bytes32 indexed payee);
    event NomineeSet(address indexed sender, address indexed nominee, uint64 delay);
    event NomineeRemoved(address indexed sender);
    event NomineeWithdrawn(
        address indexed sender, address indexed nominee, address to, uint256 amount
    );
    /// @notice The provider reads this to pay the payee's verified account in local currency.
    event PayoutRequested(
        address indexed sender,
        bytes32 indexed payee,
        bytes32 indexed digest,
        bytes32 invoiceRef,
        uint256 amount,
        address agent
    );
    /// @notice The payee was paid. `providerRef` is the provider's order id.
    event PayoutCompleted(bytes32 indexed digest, string providerRef);
    /// @notice The provider could not pay out; the USDT is back in the sender's balance.
    event PayoutRefunded(bytes32 indexed digest, string reason);
    /// @notice The provider did not settle in time; the USDT is back in the sender's balance.
    event PayoutReclaimed(bytes32 indexed digest);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error InvalidLimit();
    error InvalidPayee();
    error NoGrant();
    error UnknownPayee();
    error ExceedsPerPayment(uint256 limit, uint256 requested);
    error ExceedsPeriodLimit(uint256 available, uint256 requested);
    error BillExpired(uint64 dueDate);
    error AlreadyPaid();
    error InvalidSignature();
    error InvalidNominee();
    error NotNominee();
    error NomineeLocked(uint256 unlocksAt);
    error NotProvider();
    error NotPending();
    error SettleWindowOpen(uint256 closesAt);

    /// @dev Records that the sender is alive. Agent payments never call this, so a silent
    ///      sender's bills keep getting paid while the nominee timer still runs out.
    modifier touch() {
        lastActive[msg.sender] = block.timestamp;
        _;
    }

    constructor(IERC20 usdt_, address provider_) EIP712("Ghar", "1") {
        if (address(usdt_) == address(0) || provider_ == address(0)) revert ZeroAddress();
        usdt = usdt_;
        provider = provider_;
    }

    /// @notice Moves `amount` USDT from the caller into their vault balance.
    /// @dev The caller must approve this contract for `amount` first.
    function deposit(uint256 amount) external nonReentrant touch {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Sends `amount` of the caller's vault balance to `to`.
    function withdraw(uint256 amount, address to) external nonReentrant touch {
        _withdraw(msg.sender, amount, to);
        emit Withdrawn(msg.sender, to, amount);
    }

    /// @notice Names who may take over the caller's balance after `delay` seconds without
    ///         any action from the caller. Replaces any earlier nominee.
    function setNominee(address nominee, uint64 delay) external touch {
        if (nominee == address(0) || nominee == msg.sender || delay == 0) {
            revert InvalidNominee();
        }
        nomineeOf[msg.sender] = Nominee(nominee, delay);
        emit NomineeSet(msg.sender, nominee, delay);
    }

    function removeNominee() external touch {
        if (nomineeOf[msg.sender].nominee == address(0)) revert NotNominee();
        delete nomineeOf[msg.sender];
        emit NomineeRemoved(msg.sender);
    }

    /// @notice Resets the caller's nominee timer without changing anything else.
    function checkIn() external touch {}

    /// @notice Once `sender` has been inactive for their chosen delay, their nominee can move
    ///         the balance out. Any action by `sender` locks the nominee out again.
    function nomineeWithdraw(address sender, uint256 amount, address to) external nonReentrant {
        Nominee memory n = nomineeOf[sender];
        if (n.nominee == address(0) || n.nominee != msg.sender) revert NotNominee();
        uint256 unlocksAt = lastActive[sender] + n.delay;
        if (block.timestamp < unlocksAt) revert NomineeLocked(unlocksAt);
        _withdraw(sender, amount, to);
        emit NomineeWithdrawn(sender, msg.sender, to, amount);
    }

    /// @notice Lets `agent` pay bills from the caller's balance within these limits.
    function setGrant(address agent, uint128 perPayment, uint128 perPeriod, uint64 period)
        external
        touch
    {
        if (agent == address(0)) revert ZeroAddress();
        _setLimit(grantOf[msg.sender][agent], perPayment, perPeriod, period);
        emit GrantSet(msg.sender, agent, perPayment, perPeriod, period);
    }

    /// @notice Removes `agent`'s grant on the caller's balance. Takes effect immediately.
    function revokeGrant(address agent) external touch {
        if (grantOf[msg.sender][agent].period == 0) revert NoGrant();
        delete grantOf[msg.sender][agent];
        emit GrantRevoked(msg.sender, agent);
    }

    /// @notice Allows paying `payee` (ENS namehash) from the caller's balance within these caps,
    ///         for bills signed by `biller`.
    function setPayee(
        bytes32 payee,
        address biller,
        uint128 perPayment,
        uint128 perPeriod,
        uint64 period
    ) external touch {
        if (payee == bytes32(0)) revert InvalidPayee();
        if (biller == address(0)) revert ZeroAddress();
        _setLimit(payeeOf[msg.sender][payee], perPayment, perPeriod, period);
        billerOf[msg.sender][payee] = biller;
        emit PayeeSet(msg.sender, payee, biller, perPayment, perPeriod, period);
    }

    /// @notice Stops all future payments from the caller's balance to `payee`.
    function removePayee(bytes32 payee) external touch {
        if (payeeOf[msg.sender][payee].period == 0) revert UnknownPayee();
        delete payeeOf[msg.sender][payee];
        delete billerOf[msg.sender][payee];
        emit PayeeRemoved(msg.sender, payee);
    }

    /// @notice Locks a biller-signed bill's amount from `sender`'s balance for the provider to
    ///         pay out. Only an agent `sender` granted can call this, and only within the grant
    ///         and the payee's caps.
    function pay(address sender, Bill calldata bill, bytes calldata signature)
        external
        nonReentrant
    {
        if (bill.amount == 0) revert ZeroAmount();
        _spendGrant(sender, bill.amount);
        _spendPayee(sender, bill.payee, bill.amount);
        if (block.timestamp > bill.dueDate) revert BillExpired(bill.dueDate);

        bytes32 digest = billDigest(bill);
        if (payoutOf[digest].status != PayoutStatus.None) revert AlreadyPaid();
        if (!SignatureChecker.isValidSignatureNow(billerOf[sender][bill.payee], digest, signature))
        {
            revert InvalidSignature();
        }

        uint256 available = balanceOf[sender];
        if (bill.amount > available) revert InsufficientBalance(available, bill.amount);
        balanceOf[sender] = available - bill.amount;
        payoutOf[digest] =
            Payout(sender, uint64(block.timestamp), PayoutStatus.Pending, bill.amount);
        emit PayoutRequested(sender, bill.payee, digest, bill.invoiceRef, bill.amount, msg.sender);
    }

    /// @notice Provider confirms the payee was paid and takes the locked USDT.
    function markPaid(bytes32 digest, string calldata providerRef) external nonReentrant {
        Payout storage p = _pendingForProvider(digest);
        p.status = PayoutStatus.Paid;
        usdt.safeTransfer(provider, p.amount);
        emit PayoutCompleted(digest, providerRef);
    }

    /// @notice Provider could not pay out, so the USDT goes back to the sender's balance.
    /// @dev Caps already charged for the bill stay charged.
    function refund(bytes32 digest, string calldata reason) external {
        Payout storage p = _pendingForProvider(digest);
        p.status = PayoutStatus.Refunded;
        balanceOf[p.sender] += p.amount;
        emit PayoutRefunded(digest, reason);
    }

    /// @notice If the provider has not settled within SETTLE_WINDOW, anyone can return the USDT
    ///         to the sender's balance. It can only ever go back to the sender.
    function reclaim(bytes32 digest) external {
        Payout storage p = payoutOf[digest];
        if (p.status != PayoutStatus.Pending) revert NotPending();
        uint256 closesAt = uint256(p.requestedAt) + SETTLE_WINDOW;
        if (block.timestamp < closesAt) revert SettleWindowOpen(closesAt);
        p.status = PayoutStatus.Refunded;
        balanceOf[p.sender] += p.amount;
        emit PayoutReclaimed(digest);
    }

    /// @notice EIP-712 digest the biller signs. Bound to this vault and chain.
    function billDigest(Bill calldata bill) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(BILL_TYPEHASH, bill.payee, bill.invoiceRef, bill.amount, bill.dueDate)
            )
        );
    }

    /// @notice How much `agent` can still spend from `sender` in one payment right now.
    function availableToAgent(address sender, address agent) external view returns (uint256) {
        return _available(grantOf[sender][agent]);
    }

    /// @notice How much `sender` can still pay `payee` in one payment right now.
    function availableToPayee(address sender, bytes32 payee) external view returns (uint256) {
        return _available(payeeOf[sender][payee]);
    }

    function _pendingForProvider(bytes32 digest) private view returns (Payout storage p) {
        if (msg.sender != provider) revert NotProvider();
        p = payoutOf[digest];
        if (p.status != PayoutStatus.Pending) revert NotPending();
    }

    function _withdraw(address sender, uint256 amount, address to) private {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        balanceOf[sender] = available - amount;
        usdt.safeTransfer(to, amount);
    }

    /// @dev Charges `amount` to the grant `sender` gave `msg.sender`.
    function _spendGrant(address sender, uint256 amount) internal {
        Limit storage l = grantOf[sender][msg.sender];
        if (l.period == 0) revert NoGrant();
        _spend(l, amount);
    }

    /// @dev Charges `amount` to the cap `sender` set for `payee`.
    function _spendPayee(address sender, bytes32 payee, uint256 amount) internal {
        Limit storage l = payeeOf[sender][payee];
        if (l.period == 0) revert UnknownPayee();
        _spend(l, amount);
    }

    /// @dev Updating an existing limit keeps what was already spent in the current period,
    ///      so lowering it takes effect at once instead of handing out a fresh budget.
    function _setLimit(Limit storage l, uint128 perPayment, uint128 perPeriod, uint64 period)
        private
    {
        if (perPayment == 0 || perPeriod == 0 || period == 0) revert InvalidLimit();
        if (l.period == 0) l.periodStart = uint64(block.timestamp);
        l.perPayment = perPayment;
        l.perPeriod = perPeriod;
        l.period = period;
    }

    function _spend(Limit storage l, uint256 amount) private {
        if (amount > l.perPayment) revert ExceedsPerPayment(l.perPayment, amount);
        if (block.timestamp >= uint256(l.periodStart) + l.period) {
            uint256 elapsed = (block.timestamp - l.periodStart) / l.period;
            l.periodStart += uint64(elapsed * l.period);
            l.spent = 0;
        }
        // Lowering perPeriod below spent leaves nothing for this period, never an underflow.
        uint256 left = l.perPeriod > l.spent ? l.perPeriod - l.spent : 0;
        if (amount > left) revert ExceedsPeriodLimit(left, amount);
        l.spent += uint128(amount);
    }

    function _available(Limit memory l) private view returns (uint256) {
        if (l.period == 0) return 0;
        uint256 spent = block.timestamp >= uint256(l.periodStart) + l.period ? 0 : l.spent;
        uint256 left = l.perPeriod > spent ? l.perPeriod - spent : 0;
        return left < l.perPayment ? left : l.perPayment;
    }
}
