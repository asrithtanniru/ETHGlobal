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
        vault = new GharVault(IERC20(address(usdt)), makeAddr("provider"));
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
            abi.encodeWithSelector(
                GharVault.InsufficientBalance.selector, ONE_HUNDRED, ONE_HUNDRED + 1
            )
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

/// @dev Exposes the internal limit checks until `pay` calls them.
contract GrantHarness is GharVault {
    constructor(IERC20 usdt_) GharVault(usdt_, address(0xBEEF)) {}

    function spend(address sender, uint256 amount) external {
        _spendGrant(sender, amount);
    }

    function spendPayee(address sender, bytes32 payee, uint256 amount) external {
        _spendPayee(sender, payee, amount);
    }
}

contract GharVaultGrantTest is Test {
    GrantHarness internal vault;

    address internal sender = makeAddr("sender");
    address internal agent = makeAddr("agent");
    address internal other = makeAddr("other");

    uint64 internal constant MONTH = 30 days;

    function setUp() public {
        vault = new GrantHarness(IERC20(address(new TestUSDT())));
        vm.prank(sender);
        vault.setGrant(agent, 50e6, 80e6, MONTH);
    }

    function _spend(uint256 amount) internal {
        vm.prank(agent);
        vault.spend(sender, amount);
    }

    function test_SetGrantStoresLimits() public view {
        (uint128 perPayment, uint128 perPeriod, uint64 period, uint64 start, uint128 spent) =
            vault.grantOf(sender, agent);
        assertEq(perPayment, 50e6);
        assertEq(perPeriod, 80e6);
        assertEq(period, MONTH);
        assertEq(start, block.timestamp);
        assertEq(spent, 0);
        assertEq(vault.availableToAgent(sender, agent), 50e6);
    }

    function test_SpendWithinLimits() public {
        _spend(50e6);
        _spend(30e6);
        assertEq(vault.availableToAgent(sender, agent), 0);
    }

    function test_RevertWhen_OverPerPayment() public {
        vm.expectRevert(
            abi.encodeWithSelector(GharVault.ExceedsPerPayment.selector, 50e6, 50e6 + 1)
        );
        _spend(50e6 + 1);
    }

    function test_RevertWhen_OverPeriodLimit() public {
        _spend(50e6);
        vm.expectRevert(abi.encodeWithSelector(GharVault.ExceedsPeriodLimit.selector, 30e6, 31e6));
        _spend(31e6);
    }

    function test_PeriodResetsAtBoundary() public {
        _spend(50e6);
        _spend(30e6);
        vm.warp(block.timestamp + MONTH - 1);
        vm.expectRevert(abi.encodeWithSelector(GharVault.ExceedsPeriodLimit.selector, 0, 1));
        _spend(1);
        vm.warp(block.timestamp + 1);
        _spend(50e6);
    }

    function test_PeriodWindowsStayAligned() public {
        uint256 start = block.timestamp;
        vm.warp(start + MONTH + MONTH / 2);
        _spend(50e6);
        (,,, uint64 periodStart,) = vault.grantOf(sender, agent);
        assertEq(periodStart, start + MONTH);
    }

    function test_RevertWhen_NoGrant() public {
        vm.expectRevert(GharVault.NoGrant.selector);
        vm.prank(other);
        vault.spend(sender, 1);
    }

    function test_RevertWhen_UsingGrantOnAnotherSender() public {
        vm.expectRevert(GharVault.NoGrant.selector);
        vm.prank(agent);
        vault.spend(other, 1);
    }

    function test_RevokeStopsSpending() public {
        vm.expectEmit(address(vault));
        emit GharVault.GrantRevoked(sender, agent);
        vm.prank(sender);
        vault.revokeGrant(agent);

        vm.expectRevert(GharVault.NoGrant.selector);
        _spend(1);
        assertEq(vault.availableToAgent(sender, agent), 0);
    }

    function test_RevertWhen_RevokingMissingGrant() public {
        vm.expectRevert(GharVault.NoGrant.selector);
        vm.prank(sender);
        vault.revokeGrant(other);
    }

    function test_UpdateKeepsSpentInCurrentPeriod() public {
        _spend(50e6);
        vm.prank(sender);
        vault.setGrant(agent, 50e6, 40e6, MONTH);

        vm.expectRevert(abi.encodeWithSelector(GharVault.ExceedsPeriodLimit.selector, 0, 1));
        _spend(1);
    }

    function test_RevertWhen_GrantIsInvalid() public {
        vm.startPrank(sender);
        vm.expectRevert(GharVault.ZeroAddress.selector);
        vault.setGrant(address(0), 1, 1, 1);
        vm.expectRevert(GharVault.InvalidLimit.selector);
        vault.setGrant(agent, 0, 1, 1);
        vm.expectRevert(GharVault.InvalidLimit.selector);
        vault.setGrant(agent, 1, 0, 1);
        vm.expectRevert(GharVault.InvalidLimit.selector);
        vault.setGrant(agent, 1, 1, 0);
        vm.stopPrank();
    }

    function test_MaxPeriodDoesNotOverflow() public {
        vm.prank(sender);
        vault.setGrant(agent, 1, 1, type(uint64).max);
        _spend(1);
        assertEq(vault.availableToAgent(sender, agent), 0);
    }

    /// Whatever the timing and amounts, one period never pays out more than perPeriod.
    function testFuzz_PeriodTotalNeverExceedsLimit(
        uint256[8] memory amounts,
        uint256[8] memory gaps
    ) public {
        uint256 windowStart = block.timestamp;
        uint256 spentInWindow;
        for (uint256 i; i < amounts.length; i++) {
            vm.warp(block.timestamp + bound(gaps[i], 0, MONTH / 2));
            if (block.timestamp >= windowStart + MONTH) {
                windowStart += ((block.timestamp - windowStart) / MONTH) * MONTH;
                spentInWindow = 0;
            }
            uint256 amount = bound(amounts[i], 1, 60e6);
            vm.prank(agent);
            try vault.spend(sender, amount) {
                spentInWindow += amount;
            } catch {}
            assertLe(spentInWindow, 80e6);
        }
    }
}

contract GharVaultPayeeTest is Test {
    GrantHarness internal vault;

    address internal sender = makeAddr("sender");
    address internal other = makeAddr("other");
    address internal biller = makeAddr("biller");

    bytes32 internal constant RENT = keccak256("rent.you.eth");
    bytes32 internal constant SCHOOL = keccak256("school.you.eth");
    uint64 internal constant MONTH = 30 days;

    function setUp() public {
        vault = new GrantHarness(IERC20(address(new TestUSDT())));
        vm.prank(sender);
        vault.setPayee(RENT, biller, 500e6, 500e6, MONTH);
    }

    function _pay(bytes32 payee, uint256 amount) internal {
        vault.spendPayee(sender, payee, amount);
    }

    function test_ProviderIsFixedAtDeploy() public view {
        assertEq(vault.provider(), address(0xBEEF));
    }

    function test_RevertWhen_ProviderIsZero() public {
        vm.expectRevert(GharVault.ZeroAddress.selector);
        new GharVault(IERC20(address(1)), address(0));
    }

    function test_SetPayeeStoresCap() public view {
        (uint128 perPayment, uint128 perPeriod, uint64 period,,) = vault.payeeOf(sender, RENT);
        assertEq(perPayment, 500e6);
        assertEq(perPeriod, 500e6);
        assertEq(period, MONTH);
        assertEq(vault.availableToPayee(sender, RENT), 500e6);
    }

    function test_PayeeCapEnforcedPerPeriod() public {
        _pay(RENT, 500e6);
        vm.expectRevert(abi.encodeWithSelector(GharVault.ExceedsPeriodLimit.selector, 0, 1));
        _pay(RENT, 1);
        vm.warp(block.timestamp + MONTH);
        _pay(RENT, 500e6);
    }

    function test_PayeesHaveSeparateCaps() public {
        vm.prank(sender);
        vault.setPayee(SCHOOL, biller, 200e6, 200e6, MONTH);
        _pay(RENT, 500e6);
        _pay(SCHOOL, 200e6);
        assertEq(vault.availableToPayee(sender, RENT), 0);
        assertEq(vault.availableToPayee(sender, SCHOOL), 0);
    }

    function test_RevertWhen_PayeeUnknown() public {
        vm.expectRevert(GharVault.UnknownPayee.selector);
        _pay(SCHOOL, 1);
    }

    function test_RevertWhen_PayeeBelongsToAnotherSender() public {
        vm.expectRevert(GharVault.UnknownPayee.selector);
        vault.spendPayee(other, RENT, 1);
    }

    function test_RemovePayeeStopsPayments() public {
        vm.expectEmit(address(vault));
        emit GharVault.PayeeRemoved(sender, RENT);
        vm.prank(sender);
        vault.removePayee(RENT);

        vm.expectRevert(GharVault.UnknownPayee.selector);
        _pay(RENT, 1);
        assertEq(vault.availableToPayee(sender, RENT), 0);
        assertEq(vault.billerOf(sender, RENT), address(0));
    }

    function test_RevertWhen_RemovingUnknownPayee() public {
        vm.expectRevert(GharVault.UnknownPayee.selector);
        vm.prank(sender);
        vault.removePayee(SCHOOL);
    }

    function test_RevertWhen_PayeeIsInvalid() public {
        vm.startPrank(sender);
        vm.expectRevert(GharVault.InvalidPayee.selector);
        vault.setPayee(bytes32(0), biller, 1, 1, 1);
        vm.expectRevert(GharVault.ZeroAddress.selector);
        vault.setPayee(SCHOOL, address(0), 1, 1, 1);
        vm.expectRevert(GharVault.InvalidLimit.selector);
        vault.setPayee(SCHOOL, biller, 0, 1, 1);
        vm.stopPrank();
    }
}

contract GharVaultPayTest is Test {
    TestUSDT internal usdt;
    GharVault internal vault;

    address internal sender = makeAddr("sender");
    address internal sibling = makeAddr("sibling");
    address internal agent = makeAddr("agent");
    address internal provider = makeAddr("provider");
    address internal biller;
    uint256 internal billerKey;

    bytes32 internal constant RENT = keccak256("rent.you.eth");
    uint64 internal constant MONTH = 30 days;

    function setUp() public {
        (biller, billerKey) = makeAddrAndKey("biller");
        usdt = new TestUSDT();
        vault = new GharVault(IERC20(address(usdt)), provider);
        _fund(sender);
    }

    function _fund(address who) internal {
        usdt.mint(who, 1000e6);
        vm.startPrank(who);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(1000e6);
        vault.setGrant(agent, 600e6, 1000e6, MONTH);
        vault.setPayee(RENT, biller, 600e6, 1000e6, MONTH);
        vm.stopPrank();
    }

    function _bill(uint256 amount) internal view returns (GharVault.Bill memory) {
        return GharVault.Bill({
            payee: RENT,
            invoiceRef: keccak256("INV-2026-11"),
            amount: amount,
            dueDate: uint64(block.timestamp + 7 days)
        });
    }

    function _sign(uint256 key, GharVault.Bill memory bill) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.billDigest(bill));
        return abi.encodePacked(r, s, v);
    }

    function _pay(GharVault.Bill memory bill, bytes memory sig) internal {
        vm.prank(agent);
        vault.pay(sender, bill, sig);
    }

    function test_PaySendsToProvider() public {
        GharVault.Bill memory bill = _bill(500e6);
        bytes32 digest = vault.billDigest(bill);

        vm.expectEmit(address(vault));
        emit GharVault.Paid(sender, RENT, digest, bill.invoiceRef, 500e6, agent);
        _pay(bill, _sign(billerKey, bill));

        assertEq(usdt.balanceOf(provider), 500e6);
        assertEq(vault.balanceOf(sender), 500e6);
        assertTrue(vault.paid(digest));
    }

    /// Off-chain signers (viem signTypedData) must produce this exact digest.
    function test_DigestMatchesStandardEip712() public view {
        GharVault.Bill memory bill = _bill(500e6);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Ghar"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                vault.BILL_TYPEHASH(), bill.payee, bill.invoiceRef, bill.amount, bill.dueDate
            )
        );
        assertEq(
            vault.billDigest(bill), keccak256(abi.encodePacked("\x19\x01", domain, structHash))
        );
    }

    function test_RevertWhen_BillPaidTwice() public {
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        _pay(bill, sig);
        vm.expectRevert(GharVault.AlreadyPaid.selector);
        _pay(bill, sig);
    }

    function test_RevertWhen_AnotherSenderPaysSameBill() public {
        _fund(sibling);
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        _pay(bill, sig);

        vm.expectRevert(GharVault.AlreadyPaid.selector);
        vm.prank(agent);
        vault.pay(sibling, bill, sig);
    }

    function test_PayableOnDueDateNotAfter() public {
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        vm.warp(bill.dueDate + 1);
        vm.expectRevert(abi.encodeWithSelector(GharVault.BillExpired.selector, bill.dueDate));
        _pay(bill, sig);

        vm.warp(bill.dueDate);
        _pay(bill, sig);
    }

    function test_RevertWhen_SignedByWrongWallet() public {
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(strangerKey, bill);
        vm.expectRevert(GharVault.InvalidSignature.selector);
        _pay(bill, sig);
    }

    function test_RevertWhen_AmountTamperedAfterSigning() public {
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        bill.amount = 500e6;
        vm.expectRevert(GharVault.InvalidSignature.selector);
        _pay(bill, sig);
    }

    function test_RevertWhen_SignedForAnotherVault() public {
        GharVault otherVault = new GharVault(IERC20(address(usdt)), provider);
        GharVault.Bill memory bill = _bill(100e6);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(billerKey, otherVault.billDigest(bill));
        vm.expectRevert(GharVault.InvalidSignature.selector);
        _pay(bill, abi.encodePacked(r, s, v));
    }

    function test_RevertWhen_CallerHasNoGrant() public {
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        vm.expectRevert(GharVault.NoGrant.selector);
        vm.prank(sibling);
        vault.pay(sender, bill, sig);
    }

    function test_RevertWhen_PayeeNotAllowed() public {
        GharVault.Bill memory bill = _bill(100e6);
        bill.payee = keccak256("school.you.eth");
        bytes memory sig = _sign(billerKey, bill);
        vm.expectRevert(GharVault.UnknownPayee.selector);
        _pay(bill, sig);
    }

    function test_RevertWhen_OverCaps() public {
        GharVault.Bill memory bill = _bill(601e6);
        bytes memory sig = _sign(billerKey, bill);
        vm.expectRevert(abi.encodeWithSelector(GharVault.ExceedsPerPayment.selector, 600e6, 601e6));
        _pay(bill, sig);
    }

    function test_RevertWhen_BalanceTooLow() public {
        vm.prank(sender);
        vault.withdraw(950e6, sender);
        GharVault.Bill memory bill = _bill(100e6);
        bytes memory sig = _sign(billerKey, bill);
        vm.expectRevert(abi.encodeWithSelector(GharVault.InsufficientBalance.selector, 50e6, 100e6));
        _pay(bill, sig);
    }

    function test_RevertWhen_AmountIsZero() public {
        GharVault.Bill memory bill = _bill(0);
        bytes memory sig = _sign(billerKey, bill);
        vm.expectRevert(GharVault.ZeroAmount.selector);
        _pay(bill, sig);
    }

    function test_FailedPayLeavesStateUntouched() public {
        GharVault.Bill memory bill = _bill(100e6);
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes memory sig = _sign(strangerKey, bill);
        vm.expectRevert(GharVault.InvalidSignature.selector);
        _pay(bill, sig);

        assertEq(vault.availableToAgent(sender, agent), 600e6);
        assertEq(vault.availableToPayee(sender, RENT), 600e6);
        assertEq(vault.balanceOf(sender), 1000e6);
    }
}

contract GharVaultNomineeTest is Test {
    TestUSDT internal usdt;
    GharVault internal vault;

    address internal sender = makeAddr("sender");
    address internal nominee = makeAddr("nominee");
    address internal agent = makeAddr("agent");
    address internal other = makeAddr("other");
    address internal biller;
    uint256 internal billerKey;

    bytes32 internal constant RENT = keccak256("rent.you.eth");
    uint64 internal constant DELAY = 90 days;

    function setUp() public {
        (biller, billerKey) = makeAddrAndKey("biller");
        usdt = new TestUSDT();
        vault = new GharVault(IERC20(address(usdt)), makeAddr("provider"));
        usdt.mint(sender, 1000e6);
        vm.startPrank(sender);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(1000e6);
        vault.setNominee(nominee, DELAY);
        vm.stopPrank();
    }

    function _nomineeWithdraw(uint256 amount) internal {
        vm.prank(nominee);
        vault.nomineeWithdraw(sender, amount, nominee);
    }

    function test_SetNomineeStoresAndTouches() public view {
        (address n, uint64 delay) = vault.nomineeOf(sender);
        assertEq(n, nominee);
        assertEq(delay, DELAY);
        assertEq(vault.lastActive(sender), block.timestamp);
    }

    function test_NomineeLockedUntilDelayPasses() public {
        uint256 unlocksAt = block.timestamp + DELAY;
        vm.warp(unlocksAt - 1);
        vm.expectRevert(abi.encodeWithSelector(GharVault.NomineeLocked.selector, unlocksAt));
        _nomineeWithdraw(1);

        vm.warp(unlocksAt);
        vm.expectEmit(address(vault));
        emit GharVault.NomineeWithdrawn(sender, nominee, nominee, 1000e6);
        _nomineeWithdraw(1000e6);
        assertEq(usdt.balanceOf(nominee), 1000e6);
        assertEq(vault.balanceOf(sender), 0);
    }

    function test_SenderActionResetsTimer() public {
        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(sender);
        vault.checkIn();

        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(
            abi.encodeWithSelector(GharVault.NomineeLocked.selector, block.timestamp + 1)
        );
        _nomineeWithdraw(1);
    }

    function test_EverySenderActionTouches() public {
        vm.startPrank(sender);
        vm.warp(block.timestamp + 1);
        vault.withdraw(1, sender);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.warp(block.timestamp + 1);
        vault.setGrant(agent, 1, 1, 1);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.warp(block.timestamp + 1);
        vault.revokeGrant(agent);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.warp(block.timestamp + 1);
        vault.setPayee(RENT, biller, 1, 1, 1);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.warp(block.timestamp + 1);
        vault.removePayee(RENT);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.warp(block.timestamp + 1);
        vault.deposit(1);
        assertEq(vault.lastActive(sender), block.timestamp);
        vm.stopPrank();
    }

    function test_AgentPaymentsDoNotResetTimer() public {
        vm.startPrank(sender);
        vault.setGrant(agent, 100e6, 1000e6, 30 days);
        vault.setPayee(RENT, biller, 100e6, 1000e6, 30 days);
        vm.stopPrank();
        uint256 activeAt = block.timestamp;

        vm.warp(block.timestamp + 10 days);
        GharVault.Bill memory bill = GharVault.Bill({
            payee: RENT,
            invoiceRef: keccak256("INV-1"),
            amount: 100e6,
            dueDate: uint64(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(billerKey, vault.billDigest(bill));
        vm.prank(agent);
        vault.pay(sender, bill, abi.encodePacked(r, s, v));

        assertEq(vault.lastActive(sender), activeAt);
        vm.warp(activeAt + DELAY);
        _nomineeWithdraw(900e6);
    }

    function test_RevertWhen_NotTheNominee() public {
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GharVault.NotNominee.selector);
        vm.prank(other);
        vault.nomineeWithdraw(sender, 1, other);
    }

    function test_RevertWhen_SenderHasNoNominee() public {
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GharVault.NotNominee.selector);
        vm.prank(nominee);
        vault.nomineeWithdraw(other, 1, nominee);
    }

    function test_RemoveNomineeBlocksTakeover() public {
        vm.prank(sender);
        vault.removeNominee();
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GharVault.NotNominee.selector);
        _nomineeWithdraw(1);
    }

    function test_RevertWhen_NomineeOverdraws() public {
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(
            abi.encodeWithSelector(GharVault.InsufficientBalance.selector, 1000e6, 1000e6 + 1)
        );
        _nomineeWithdraw(1000e6 + 1);
    }

    function test_RevertWhen_NomineeIsInvalid() public {
        vm.startPrank(sender);
        vm.expectRevert(GharVault.InvalidNominee.selector);
        vault.setNominee(address(0), DELAY);
        vm.expectRevert(GharVault.InvalidNominee.selector);
        vault.setNominee(sender, DELAY);
        vm.expectRevert(GharVault.InvalidNominee.selector);
        vault.setNominee(nominee, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_RemovingMissingNominee() public {
        vm.expectRevert(GharVault.NotNominee.selector);
        vm.prank(other);
        vault.removeNominee();
    }

    function test_MaxDelayDoesNotOverflow() public {
        vm.prank(sender);
        vault.setNominee(nominee, type(uint64).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                GharVault.NomineeLocked.selector, block.timestamp + type(uint64).max
            )
        );
        _nomineeWithdraw(1);
    }
}
