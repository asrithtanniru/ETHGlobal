// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title GharPayout (spike)
/// @notice Minimal USDT -> INR payout escrow on Whitechain.
///  1. Sender approves USDT, then calls requestPayout(amount, payeeRef).
///     USDT is locked here and PayoutRequested is emitted.
///  2. The off-chain adapter sees the event and creates an INR payout with the provider (Onramp sandbox).
///  3. The adapter (operator) calls markPaid -> USDT goes to the provider treasury,
///     or refund -> USDT goes back to the sender.
contract GharPayout {
    enum Status { None, Requested, Paid, Refunded }

    struct Payout {
        address sender;
        uint256 amount;      // USDT, 6 decimals
        bytes32 payeeRef;    // e.g. bytes32("rent"); adapter maps it to the provider's payee id
        Status status;
    }

    IERC20 public immutable usdt;
    address public immutable operator;  // adapter key
    address public immutable treasury;  // where USDT goes once the provider confirms INR was paid

    uint256 public nextId;
    mapping(uint256 => Payout) public payouts;

    event PayoutRequested(uint256 indexed id, address indexed sender, uint256 amount, bytes32 payeeRef);
    event PayoutCompleted(uint256 indexed id, string providerTxId, uint256 inrPaise);
    event PayoutRefunded(uint256 indexed id, string reason);

    error NotOperator();
    error BadStatus();
    error ZeroAmount();
    error TransferFailed();

    constructor(address usdt_, address operator_, address treasury_) {
        usdt = IERC20(usdt_);
        operator = operator_;
        treasury = treasury_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function requestPayout(uint256 amount, bytes32 payeeRef) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(msg.sender, address(this), amount);
        id = nextId++;
        payouts[id] = Payout(msg.sender, amount, payeeRef, Status.Requested);
        emit PayoutRequested(id, msg.sender, amount, payeeRef);
    }

    function markPaid(uint256 id, string calldata providerTxId, uint256 inrPaise) external onlyOperator {
        Payout storage p = payouts[id];
        if (p.status != Status.Requested) revert BadStatus();
        p.status = Status.Paid;
        _safeTransfer(treasury, p.amount);
        emit PayoutCompleted(id, providerTxId, inrPaise);
    }

    function refund(uint256 id, string calldata reason) external onlyOperator {
        Payout storage p = payouts[id];
        if (p.status != Status.Requested) revert BadStatus();
        p.status = Status.Refunded;
        _safeTransfer(p.sender, p.amount);
        emit PayoutRefunded(id, reason);
    }

    // USDT-style tokens may not return a bool, so check with a low-level call.
    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdt).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdt).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
