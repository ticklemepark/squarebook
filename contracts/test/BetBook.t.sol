// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BetBookTestBase} from "./BetBookTestBase.sol";
import {BetBook} from "../src/BetBook.sol";

contract BetBookTest is BetBookTestBase {
    // ---------------------------------------------------------------- members

    function test_initialMembers() public view {
        assertEq(book.memberCount(), 5);
        (string memory name,, bool exists) = book.members(alice);
        assertTrue(exists);
        assertEq(name, "Alice");
    }

    function test_addMember_onlyMember() public {
        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert("not a member");
        book.addMember(mallory, "Mallory");
    }

    function test_addMember_duplicateReverts() public {
        vm.prank(alice);
        vm.expectRevert("already a member");
        book.addMember(bob, "Bob again");
    }

    function test_setMyName() public {
        vm.prank(alice);
        book.setMyName("Alicia");
        (string memory name,,) = book.members(alice);
        assertEq(name, "Alicia");
    }

    // ---------------------------------------------------------------- propose

    function test_proposeBet() public {
        uint256 id = proposeBet();
        BetBook.Bet memory b = book.getBet(id);
        assertEq(b.maker, alice);
        assertEq(b.taker, bob);
        assertEq(b.stakeQty, 2);
        assertEq(b.stakeUnit, "coffee");
        assertEq(b.parentId, book.NO_BET());
        assertFalse(b.isDouble);
        assertStatus(id, BetBook.Status.Proposed);
    }

    function test_propose_nonMemberTakerReverts() public {
        vm.prank(alice);
        vm.expectRevert("taker not a member");
        book.proposeBet(makeAddr("stranger"), "x", 1, "coffee", uint64(block.timestamp + 1 days));
    }

    function test_propose_selfBetReverts() public {
        vm.prank(alice);
        vm.expectRevert("cannot bet yourself");
        book.proposeBet(alice, "x", 1, "coffee", uint64(block.timestamp + 1 days));
    }

    function test_propose_zeroStakeReverts() public {
        vm.prank(alice);
        vm.expectRevert("zero stake");
        book.proposeBet(bob, "x", 0, "coffee", uint64(block.timestamp + 1 days));
    }

    function test_propose_byNonMemberReverts() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("not a member");
        book.proposeBet(bob, "x", 1, "coffee", uint64(block.timestamp + 1 days));
    }

    // ---------------------------------------------- accept / decline / cancel

    function test_acceptBet() public {
        uint256 id = activeBet();
        assertStatus(id, BetBook.Status.Active);
    }

    function test_accept_onlyTaker() public {
        uint256 id = proposeBet();
        vm.prank(carol);
        vm.expectRevert("only taker");
        book.acceptBet(id);
    }

    function test_expiredProposalCannotBeAccepted() public {
        uint256 id = proposeBet();
        vm.warp(block.timestamp + 8 days);
        vm.prank(bob);
        vm.expectRevert("proposal expired");
        book.acceptBet(id);
    }

    function test_declineBet() public {
        uint256 id = proposeBet();
        vm.prank(bob);
        book.declineBet(id);
        assertStatus(id, BetBook.Status.Declined);
    }

    function test_cancelBet_onlyMaker() public {
        uint256 id = proposeBet();
        vm.prank(bob);
        vm.expectRevert("only maker");
        book.cancelBet(id);
        vm.prank(alice);
        book.cancelBet(id);
        assertStatus(id, BetBook.Status.Canceled);
    }

    function test_cancel_afterAcceptReverts() public {
        uint256 id = activeBet();
        vm.prank(alice);
        vm.expectRevert("not proposed");
        book.cancelBet(id);
    }

    // ------------------------------------------------------- claim / respond

    function test_claim_onlyParty() public {
        uint256 id = activeBet();
        vm.prank(carol);
        vm.expectRevert("not a party");
        book.claimOutcome(id, BetBook.Outcome.MakerWins);
    }

    function test_claim_beforeAcceptReverts() public {
        uint256 id = proposeBet();
        vm.prank(alice);
        vm.expectRevert("not active");
        book.claimOutcome(id, BetBook.Outcome.MakerWins);
    }

    function test_respondWithSameOutcomeResolvesWithoutVote() public {
        uint256 id = resolvedBet();
        assertStatus(id, BetBook.Status.Resolved);
        assertOutcome(id, BetBook.Outcome.MakerWins);
    }

    function test_claimantCannotRespondToOwnClaim() public {
        uint256 id = claimedBet(BetBook.Outcome.MakerWins);
        vm.prank(alice);
        vm.expectRevert("claimant cannot respond");
        book.respondToClaim(id, BetBook.Outcome.MakerWins);
    }

    function test_takerCanClaimToo() public {
        uint256 id = activeBet();
        vm.prank(bob);
        book.claimOutcome(id, BetBook.Outcome.MakerWins); // bob concedes
        vm.prank(alice);
        book.respondToClaim(id, BetBook.Outcome.MakerWins);
        assertStatus(id, BetBook.Status.Resolved);
    }

    function test_agreedPushAutoSettles() public {
        uint256 id = claimedBet(BetBook.Outcome.Push);
        vm.prank(bob);
        book.respondToClaim(id, BetBook.Outcome.Push);
        assertStatus(id, BetBook.Status.Settled);
    }

    // ------------------------------------------------------------- settlement

    function test_markSettled_winnerOnly() public {
        uint256 id = resolvedBet();
        vm.prank(bob); // bob lost
        vm.expectRevert("only winner");
        book.markSettled(id);
        vm.prank(alice);
        book.markSettled(id);
        assertStatus(id, BetBook.Status.Settled);
    }

    function test_settleTwiceReverts() public {
        uint256 id = resolvedBet();
        vm.prank(alice);
        book.markSettled(id);
        vm.prank(alice);
        vm.expectRevert("not resolved");
        book.markSettled(id);
    }

    function test_markSettled_beforeResolveReverts() public {
        uint256 id = activeBet();
        vm.prank(alice);
        vm.expectRevert("not resolved");
        book.markSettled(id);
    }
}
