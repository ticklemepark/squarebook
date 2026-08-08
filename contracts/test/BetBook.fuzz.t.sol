// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BetBookTestBase} from "./BetBookTestBase.sol";
import {BetBook} from "../src/BetBook.sol";

/// Random action sequences from random members must never leave any bet in an
/// inconsistent state, whatever succeeds or reverts along the way.
contract BetBookFuzzTest is BetBookTestBase {
    address[5] internal actors;

    function setUp() public override {
        super.setUp();
        actors = [alice, bob, carol, dave, erin];
    }

    function testFuzz_lifecycleNeverReachesInvalidState(uint256[] memory seeds) public {
        vm.assume(seeds.length <= 64);
        for (uint256 i = 0; i < seeds.length; i++) {
            _step(seeds[i]);
        }
        _checkInvariants();
    }

    function _step(uint256 seed) internal {
        uint256 action = seed % 12;
        address actor = actors[(seed >> 8) % 5];
        uint256 count = book.betCount();
        uint256 id = count == 0 ? 0 : (seed >> 16) % count;
        BetBook.Outcome o = BetBook.Outcome(1 + ((seed >> 24) % 3));
        address taker = actors[(seed >> 32) % 5];

        vm.startPrank(actor);
        if (action == 0) {
            try book.proposeBet(taker, "bet", uint32(1 + (seed % 5)), "coffee", uint64(block.timestamp + 1 days)) {} catch {}
        } else if (action == 1) {
            try book.acceptBet(id) {} catch {}
        } else if (action == 2) {
            try book.declineBet(id) {} catch {}
        } else if (action == 3) {
            try book.cancelBet(id) {} catch {}
        } else if (action == 4) {
            try book.claimOutcome(id, o) {} catch {}
        } else if (action == 5) {
            try book.respondToClaim(id, o) {} catch {}
        } else if (action == 6) {
            try book.escalate(id) {} catch {}
        } else if (action == 7) {
            try book.vote(id, o) {} catch {}
        } else if (action == 8) {
            try book.finalizeVote(id) {} catch {}
        } else if (action == 9) {
            try book.markSettled(id) {} catch {}
        } else if (action == 10) {
            try book.proposeDoubleOrNothing(id, "double", uint64(block.timestamp + 1 days)) {} catch {}
        } else {
            vm.warp(block.timestamp + ((seed >> 40) % 4 days));
        }
        vm.stopPrank();
    }

    function _checkInvariants() internal view {
        uint256 count = book.betCount();
        for (uint256 id = 0; id < count; id++) {
            BetBook.Bet memory b = book.getBet(id);
            assertTrue(b.status != BetBook.Status.None, "bet in None status");

            bool hasOutcome = b.outcome != BetBook.Outcome.None;
            bool resolvedish = b.status == BetBook.Status.Resolved || b.status == BetBook.Status.Settled
                || b.status == BetBook.Status.Superseded;
            assertEq(hasOutcome, resolvedish, "outcome/status mismatch");

            assertEq(b.isDouble, b.parentId != book.NO_BET(), "double/parent mismatch");
            if (b.isDouble) {
                BetBook.Bet memory parent = book.getBet(b.parentId);
                // a superseded parent must point at a child that is past proposal
                if (parent.childId == id && parent.status == BetBook.Status.Superseded) {
                    assertTrue(
                        b.status != BetBook.Status.Proposed && b.status != BetBook.Status.Declined
                            && b.status != BetBook.Status.Canceled,
                        "superseded parent with dead child"
                    );
                }
                assertEq(b.stakeQty, parent.stakeQty * 2, "child stake not doubled");
            }
        }
    }
}
