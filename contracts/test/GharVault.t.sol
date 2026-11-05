// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GharVault} from "../src/GharVault.sol";

contract TestUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GharVaultTest is Test {
    TestUSDT internal usdt;
    GharVault internal vault;

    address internal sender = makeAddr("sender");
    address internal other = makeAddr("other");

    uint256 internal constant ONE_HUNDRED = 100e6;

    function setUp() public {
        usdt = new TestUSDT();
        vault = new GharVault(IERC20(address(usdt)));
        usdt.mint(sender, ONE_HUNDRED);
        vm.prank(sender);
        usdt.approve(address(vault), type(uint256).max);
    }

    function test_DepositCreditsSender() public {
        vm.expectEmit(address(vault));
        emit GharVault.Deposited(sender, ONE_HUNDRED);
        vm.prank(sender);
        vault.deposit(ONE_HUNDRED);

        assertEq(vault.balanceOf(sender), ONE_HUNDRED);
        assertEq(usdt.balanceOf(address(vault)), ONE_HUNDRED);
    }

    function test_WithdrawSendsToRecipient() public {
        vm.startPrank(sender);
        vault.deposit(ONE_HUNDRED);
        vault.withdraw(40e6, other);
        vm.stopPrank();

        assertEq(vault.balanceOf(sender), 60e6);
        assertEq(usdt.balanceOf(other), 40e6);
    }

    function test_RevertWhen_WithdrawingMoreThanBalance() public {
        vm.prank(sender);
        vault.deposit(ONE_HUNDRED);

        vm.expectRevert(
            abi.encodeWithSelector(GharVault.InsufficientBalance.selector, ONE_HUNDRED, ONE_HUNDRED + 1)
        );
        vm.prank(sender);
        vault.withdraw(ONE_HUNDRED + 1, sender);
    }

    function test_RevertWhen_WithdrawingAnotherSendersBalance() public {
        vm.prank(sender);
        vault.deposit(ONE_HUNDRED);

        vm.expectRevert(abi.encodeWithSelector(GharVault.InsufficientBalance.selector, 0, 1));
        vm.prank(other);
        vault.withdraw(1, other);
    }

    function test_RevertWhen_DepositIsZero() public {
        vm.expectRevert(GharVault.ZeroAmount.selector);
        vm.prank(sender);
        vault.deposit(0);
    }
}
