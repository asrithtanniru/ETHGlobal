// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GharVault} from "../src/GharVault.sol";

contract StakeUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GharVaultStakeTest is Test {
    StakeUSDT internal usdt;
    GharVault internal vault;

    address internal sender = makeAddr("sender");
    address internal stranger = makeAddr("stranger");
    address internal nominee = makeAddr("nominee");
    address internal agent = makeAddr("agent");
    address internal biller;
    uint256 internal billerKey;

    bytes32 internal constant PAYEE = keccak256("rent.gharfam.eth");
    uint64 internal constant DELAY = 30 days;
    uint128 internal constant KEEP = 20e6;

    function setUp() public {
        (biller, billerKey) = makeAddrAndKey("biller");
        usdt = new StakeUSDT();
        vault = new GharVault(IERC20(address(usdt)), makeAddr("provider"));
        usdt.mint(sender, 100e6);
        usdt.mint(address(this), 50e6);
        usdt.approve(address(vault), type(uint256).max);
        vault.fundRewards(50e6);

        vm.startPrank(sender);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(100e6);
        vault.setStakePlan(DELAY, KEEP);
        vm.stopPrank();
    }

    function _goIdleAndStake() internal {
        vm.warp(block.timestamp + DELAY);
        vm.prank(stranger);
        vault.stakeIdle(sender);
    }

    function test_StakesOnlyAboveKeepAfterDelay() public {
        _goIdleAndStake();

        (uint128 principal,,) = vault.stakeOf(sender);
        assertEq(principal, 80e6);
        assertEq(vault.balanceOf(sender), KEEP);
        assertEq(usdt.balanceOf(address(vault)), 150e6);
    }

    function test_RevertWhen_NoPlan() public {
        vm.expectRevert(GharVault.NoStakePlan.selector);
        vault.stakeIdle(stranger);
    }

    function test_RevertWhen_SenderStillActive() public {
        uint256 unlocksAt = block.timestamp + DELAY;
        vm.warp(unlocksAt - 1);
        vm.expectRevert(abi.encodeWithSelector(GharVault.StakeLocked.selector, unlocksAt));
        vault.stakeIdle(sender);
    }

    function test_RevertWhen_NothingAboveKeep() public {
        vm.prank(sender);
        vault.setStakePlan(DELAY, 100e6);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GharVault.NothingToStake.selector);
        vault.stakeIdle(sender);
    }

    function test_RevertWhen_PlanDelayIsZero() public {
        vm.expectRevert(GharVault.InvalidStakePlan.selector);
        vm.prank(sender);
        vault.setStakePlan(0, KEEP);
    }

    function test_EarnsFivePercentAYear() public {
        _goIdleAndStake();
        vm.warp(block.timestamp + 365 days);

        assertEq(vault.earnedOf(sender), 4e6);
        assertEq(vault.spendableOf(sender), 104e6);
    }

    function test_UnstakeReturnsStakeAndEarningsToSender() public {
        _goIdleAndStake();
        vm.warp(block.timestamp + 365 days);

        vm.prank(stranger);
        vault.unstake(sender);

        assertEq(vault.balanceOf(sender), 104e6);
        assertEq(vault.balanceOf(stranger), 0);
        assertEq(vault.rewardReserve(), 46e6);
    }

    function test_StrangerUnstakeIsNotSenderActivity() public {
        uint256 before = vault.lastActive(sender);
        _goIdleAndStake();
        vm.prank(stranger);
        vault.unstake(sender);
        assertEq(vault.lastActive(sender), before);
    }

    function test_SenderUnstakeCountsAsActivity() public {
        _goIdleAndStake();
        vm.prank(sender);
        vault.unstake(sender);
        assertEq(vault.lastActive(sender), block.timestamp);
    }

    function test_RevertWhen_UnstakingNothing() public {
        vm.expectRevert(GharVault.NothingStaked.selector);
        vault.unstake(sender);
    }

    function test_EmptyReserveStillReturnsPrincipal() public {
        GharVault empty = new GharVault(IERC20(address(usdt)), makeAddr("provider"));
        usdt.mint(stranger, 10e6);
        vm.startPrank(stranger);
        usdt.approve(address(empty), type(uint256).max);
        empty.deposit(10e6);
        empty.setStakePlan(1 days, 0);
        vm.warp(block.timestamp + 1 days);
        empty.stakeIdle(stranger);
        vm.warp(block.timestamp + 365 days);
        assertEq(empty.earnedOf(stranger), 0);
        empty.unstake(stranger);
        vm.stopPrank();

        assertEq(empty.balanceOf(stranger), 10e6);
    }

    function test_RemovingPlanReturnsStake() public {
        _goIdleAndStake();
        vm.prank(sender);
        vault.removeStakePlan();

        (uint128 principal,,) = vault.stakeOf(sender);
        assertEq(principal, 0);
        assertEq(vault.balanceOf(sender), 100e6);
        vm.expectRevert(GharVault.NoStakePlan.selector);
        vault.stakeIdle(sender);
    }

    function test_WithdrawReachesStakedMoney() public {
        _goIdleAndStake();
        vm.prank(sender);
        vault.withdraw(100e6, sender);

        assertEq(usdt.balanceOf(sender), 100e6);
    }

    function test_NomineeReachesStakedMoney() public {
        vm.prank(sender);
        vault.setNominee(nominee, DELAY);
        _goIdleAndStake();

        vm.prank(nominee);
        vault.nomineeWithdraw(sender, 100e6, nominee);

        assertEq(usdt.balanceOf(nominee), 100e6);
    }

    function test_BillAboveBalanceIsPaidFromStake() public {
        vm.startPrank(sender);
        vault.setGrant(agent, 50e6, 50e6, 30 days);
        vault.setPayee(PAYEE, biller, 50e6, 50e6, 30 days);
        vm.stopPrank();
        _goIdleAndStake();

        GharVault.Bill memory bill = GharVault.Bill({
            payee: PAYEE,
            invoiceRef: keccak256("INV-STAKE"),
            amount: 50e6,
            dueDate: uint64(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(billerKey, vault.billDigest(bill));
        vm.prank(agent);
        vault.pay(sender, bill, abi.encodePacked(r, s, v));

        (uint128 principal,,) = vault.stakeOf(sender);
        assertEq(principal, 0);
        assertEq(vault.balanceOf(sender), 50e6);
    }

    function test_BillWithinBalanceLeavesStakeAlone() public {
        vm.startPrank(sender);
        vault.setGrant(agent, 10e6, 10e6, 30 days);
        vault.setPayee(PAYEE, biller, 10e6, 10e6, 30 days);
        vm.stopPrank();
        _goIdleAndStake();

        GharVault.Bill memory bill = GharVault.Bill({
            payee: PAYEE,
            invoiceRef: keccak256("INV-SMALL"),
            amount: 10e6,
            dueDate: uint64(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(billerKey, vault.billDigest(bill));
        vm.prank(agent);
        vault.pay(sender, bill, abi.encodePacked(r, s, v));

        (uint128 principal,,) = vault.stakeOf(sender);
        assertEq(principal, 80e6);
        assertEq(vault.balanceOf(sender), 10e6);
    }
}
