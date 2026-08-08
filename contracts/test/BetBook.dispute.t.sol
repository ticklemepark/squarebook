// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BetBookTestBase} from "./BetBookTestBase.sol";
import {BetBook} from "../src/BetBook.sol";

contract BetBookDisputeTest is BetBookTestBase {
    function test_disagreementOpensDispute() public {
        uint256 id = disputedBet();
        assertStatus(id, BetBook.Status.Disputed);
        assertEq(book.eligibleVoterCount(id), 3); // carol, dave, erin
    }

    function test_partyCannotVoteOwnDispute() public {
        uint256 id = disputedBet();
        vm.prank(alice);
        vm.expectRevert("party cannot vote");
        book.vote(id, BetBook.Outcome.MakerWins);
    }

    function test_nonMemberCannotVote() public {
        uint256 id = disputedBet();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("not a member");
        book.vote(id, BetBook.Outcome.MakerWins);
    }

    function test_memberJoinedAfterDisputeCannotVote() public {
        uint256 id = disputedBet();
        address fred = makeAddr("fred");
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        book.addMember(fred, "Fred");
        vm.prank(fred);
        vm.expectRevert("joined after dispute");
        book.vote(id, BetBook.Outcome.MakerWins);
        // and he doesn't count toward the eligible-voter denominator
        assertEq(book.eligibleVoterCount(id), 3);
    }

    function test_doubleVoteReverts() public {
        uint256 id = disputedBet();
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.MakerWins);
        vm.prank(carol);
        vm.expectRevert("already voted");
        book.vote(id, BetBook.Outcome.TakerWins);
    }

    function test_earlyMajorityFinalizes() public {
        uint256 id = disputedBet();
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.MakerWins);
        vm.prank(dave);
        book.vote(id, BetBook.Outcome.MakerWins); // 2 of 3 eligible: majority
        book.finalizeVote(id);
        assertStatus(id, BetBook.Status.Resolved);
        assertOutcome(id, BetBook.Outcome.MakerWins);
    }

    function test_finalizeBeforeWindowWithoutMajorityReverts() public {
        uint256 id = disputedBet();
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.MakerWins); // 1 of 3: no majority
        vm.expectRevert("vote still open");
        book.finalizeVote(id);
    }

    function test_pluralityWinsAfterWindow() public {
        uint256 id = disputedBet();
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.TakerWins);
        vm.warp(block.timestamp + 3 days + 1);
        book.finalizeVote(id);
        assertOutcome(id, BetBook.Outcome.TakerWins);
    }

    function test_tieVoteResolvesPush() public {
        uint256 id = disputedBet();
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.MakerWins);
        vm.prank(dave);
        book.vote(id, BetBook.Outcome.TakerWins);
        vm.warp(block.timestamp + 3 days + 1);
        book.finalizeVote(id);
        assertOutcome(id, BetBook.Outcome.Push);
        assertStatus(id, BetBook.Status.Settled); // push auto-settles
    }

    function test_zeroVotesResolvesPush() public {
        uint256 id = disputedBet();
        vm.warp(block.timestamp + 3 days + 1);
        book.finalizeVote(id);
        assertOutcome(id, BetBook.Outcome.Push);
        assertStatus(id, BetBook.Status.Settled);
    }

    function test_voteAfterFinalizeReverts() public {
        uint256 id = disputedBet();
        vm.warp(block.timestamp + 3 days + 1);
        book.finalizeVote(id);
        vm.prank(carol);
        vm.expectRevert("not disputed");
        book.vote(id, BetBook.Outcome.MakerWins);
    }

    // ---------------------------------------------------------------- escalate

    function test_escalateAfterSilence() public {
        uint256 id = claimedBet(BetBook.Outcome.MakerWins);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        book.escalate(id);
        assertStatus(id, BetBook.Status.Disputed);
    }

    function test_escalateBeforeWindowReverts() public {
        uint256 id = claimedBet(BetBook.Outcome.MakerWins);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert("too soon");
        book.escalate(id);
    }

    function test_escalate_onlyClaimant() public {
        uint256 id = claimedBet(BetBook.Outcome.MakerWins);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(bob);
        vm.expectRevert("only claimant");
        book.escalate(id);
    }

    function test_votersEligibleAfterEscalation() public {
        uint256 id = claimedBet(BetBook.Outcome.MakerWins);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        book.escalate(id);
        vm.prank(carol);
        book.vote(id, BetBook.Outcome.MakerWins);
        vm.prank(dave);
        book.vote(id, BetBook.Outcome.MakerWins);
        book.finalizeVote(id);
        assertOutcome(id, BetBook.Outcome.MakerWins);
    }
}
