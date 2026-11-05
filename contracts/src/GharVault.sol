// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GharVault
/// @notice Holds USDT for senders abroad. Every sender has an isolated balance that only
///         they can fund or withdraw. Agent grants, payee caps and the nominee timer are
///         enforced against these balances.
contract GharVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Settlement token (USDT on Whitechain).
    IERC20 public immutable usdt;

    /// @notice USDT held for each sender, in token base units.
    mapping(address sender => uint256 amount) public balanceOf;

    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed sender, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

    constructor(IERC20 usdt_) {
        if (address(usdt_) == address(0)) revert ZeroAddress();
        usdt = usdt_;
    }

    /// @notice Moves `amount` USDT from the caller into their vault balance.
    /// @dev The caller must approve this contract for `amount` first.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Sends `amount` of the caller's vault balance to `to`.
    function withdraw(uint256 amount, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        balanceOf[msg.sender] = available - amount;
        usdt.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }
}
