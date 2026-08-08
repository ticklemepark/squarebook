// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BetBookTestBase} from "./BetBookTestBase.sol";
import {BetBook} from "../src/BetBook.sol";

contract BetBookDoubleTest is BetBookTestBase {
    function doubleOffer() internal returns (uint256 parentId, uint256 childId) {
        parentId = resolvedBet(); // alice won 2 coffee, unpaid
        vm.prank(alice);
        childId = book.proposeDoubleOrNothing(parentId, "rematch", uint64(block.timestamp + 7 days));
    }

    function acceptedDouble() internal returns (uint256 parentId, uint256 childId) {
        (parentId, childId) = doubleOffer();
        vm.prank(bob);
        book.acceptBet(childId);
    }

    function test_offerShape() public {
        (uint256 parentId, uint256 childId) = doubleOffer();
        BetBook.Bet memory child = book.getBet(childId);
        assertEq(child.maker, alice); // winner proposes
        assertEq(child.taker, bob);
        assertEq(child.stakeQty, 4); // doubled
        assertEq(child.stakeUnit, "coffee");
        assertTrue(child.isDouble);
        assertEq(child.parentId, parentId);
        assertEq(book.getBet(parentId).childId, childId);
        // offer pending: parent debt still stands
        assertStatus(parentId, BetBook.Status.Resolved);
    }

    function test_onlyWinnerCanPropose() public {
        uint256 parentId = resolvedBet();
        vm.prank(bob); // loser
        vm.expectRevert("only winner");
        book.proposeDoubleOrNothing(parentId, "rematch", uint64(block.timestamp + 1 days));
    }

    function test_cannotProposeOnSettled() public {
        uint256 parentId = resolvedBet();
        vm.prank(alice);
        book.markSettled(parentId);
        vm.prank(alice);
        vm.expectRevert("parent not resolved");
        book.proposeDoubleOrNothing(parentId, "rematch", uint64(block.timestamp + 1 days));
    }

    function test_cannotProposeOnPush() public {
        uint256 id = claimedBet(BetBook.Outcome.Push);
        vm.prank(bob);
        book.respondToClaim(id, BetBook.Outcome.Push);
        vm.prank(alice);
        vm.expectRevert("parent not resolved"); // push auto-settled
        book.proposeDoubleOrNothing(id, "rematch", uint64(block.timestamp + 1 days));
    }

    function test_acceptSupersedesParent() public {
        (uint256 parentId, uint256 childId) = acceptedDouble();
        assertStatus(parentId, BetBook.Status.Superseded);
        assertStatus(childId, BetBook.Status.Active);
    }

    function test_acceptRevertsIfParentSettledMeanwhile() public {
        (uint256 parentId, uint256 childId) = doubleOffer();
        vm.prank(alice);
        book.markSettled(parentId); // bob paid up while the offer sat pending
        vm.prank(bob);
        vm.expectRevert("parent no longer open");
        book.acceptBet(childId);
    }

    function test_parentWinnerWinsChild_owedDouble() public {
        (uint256 parentId, uint256 childId) = acceptedDouble();
        vm.prank(alice);
        book.claimOutcome(childId, BetBook.Outcome.MakerWins);
        vm.prank(bob);
        book.respondToClaim(childId, BetBook.Outcome.MakerWins);
        // alice now owed 4 coffee on the child; parent stays out of balances
        assertStatus(childId, BetBook.Status.Resolved);
        assertEq(book.getBet(childId).stakeQty, 4);
        assertStatus(parentId, BetBook.Status.Superseded);
        vm.prank(alice);
        book.markSettled(childId);
        assertStatus(childId, BetBook.Status.Settled);
    }

    function test_parentLoserWinsChild_allClear() public {
        (uint256 parentId, uint256 childId) = acceptedDouble();
        vm.prank(bob);
        book.claimOutcome(childId, BetBook.Outcome.TakerWins);
        vm.prank(alice);
        book.respondToClaim(childId, BetBook.Outcome.TakerWins);
        // debt wiped: child auto-settles, parent stays superseded
        assertStatus(childId, BetBook.Status.Settled);
        assertStatus(parentId, BetBook.Status.Superseded);
    }

    function test_childPushRestoresParent() public {
        (uint256 parentId, uint256 childId) = acceptedDouble();
        vm.prank(alice);
        book.claimOutcome(childId, BetBook.Outcome.Push);
        vm.prank(bob);
        book.respondToClaim(childId, BetBook.Outcome.Push);
        // rematch void: original 2-coffee debt stands again
        assertStatus(childId, BetBook.Status.Settled);
        assertStatus(parentId, BetBook.Status.Resolved);
        vm.prank(alice);
        book.markSettled(parentId);
        assertStatus(parentId, BetBook.Status.Settled);
    }

    function test_childDisputeVotedPushRestoresParent() public {
        (uint256 parentId, uint256 childId) = acceptedDouble();
        vm.prank(alice);
        book.claimOutcome(childId, BetBook.Outcome.MakerWins);
        vm.prank(bob);
        book.respondToClaim(childId, BetBook.Outcome.TakerWins);
        vm.warp(block.timestamp + 3 days + 1); // nobody votes → push
        book.finalizeVote(childId);
        assertStatus(parentId, BetBook.Status.Resolved);
    }

    function test_declinedOfferLeavesParentUntouched() public {
        (uint256 parentId, uint256 childId) = doubleOffer();
        vm.prank(bob);
        book.declineBet(childId);
        assertStatus(parentId, BetBook.Status.Resolved);
        vm.prank(alice);
        book.markSettled(parentId);
    }

    function test_oneLiveChildPerParent() public {
        (uint256 parentId,) = doubleOffer();
        vm.prank(alice);
        vm.expectRevert("live child exists");
        book.proposeDoubleOrNothing(parentId, "again", uint64(block.timestamp + 1 days));
    }

    function test_newOfferAllowedAfterDecline() public {
        (uint256 parentId, uint256 childId) = doubleOffer();
        vm.prank(bob);
        book.declineBet(childId);
        vm.prank(alice);
        uint256 second = book.proposeDoubleOrNothing(parentId, "again", uint64(block.timestamp + 1 days));
        assertEq(book.getBet(parentId).childId, second);
    }

    function test_newOfferAllowedAfterExpiry() public {
        (uint256 parentId, uint256 childId) = doubleOffer();
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        uint256 second = book.proposeDoubleOrNothing(parentId, "again", uint64(block.timestamp + 1 days));
        assertEq(book.getBet(parentId).childId, second);
        // the stale offer can no longer be accepted
        vm.prank(bob);
        vm.expectRevert("proposal expired");
        book.acceptBet(childId);
    }

    function test_chainedDouble() public {
        // alice wins the double (owed 4), then offers double-or-nothing on it
        (, uint256 childId) = acceptedDouble();
        vm.prank(alice);
        book.claimOutcome(childId, BetBook.Outcome.MakerWins);
        vm.prank(bob);
        book.respondToClaim(childId, BetBook.Outcome.MakerWins);
        vm.prank(alice);
        uint256 grandchild = book.proposeDoubleOrNothing(childId, "triple threat", uint64(block.timestamp + 1 days));
        assertEq(book.getBet(grandchild).stakeQty, 8);
    }
}
