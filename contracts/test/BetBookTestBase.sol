// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BetBook} from "../src/BetBook.sol";

abstract contract BetBookTestBase is Test {
    BetBook internal book;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal erin = makeAddr("erin");

    function setUp() public virtual {
        address[] memory addrs = new address[](5);
        string[] memory names = new string[](5);
        (addrs[0], names[0]) = (alice, "Alice");
        (addrs[1], names[1]) = (bob, "Bob");
        (addrs[2], names[2]) = (carol, "Carol");
        (addrs[3], names[3]) = (dave, "Dave");
        (addrs[4], names[4]) = (erin, "Erin");
        book = new BetBook(addrs, names);
        // members join at deploy time; real disputes happen later. The vote
        // snapshot uses strict joinedAt < disputedAt, so move the clock on.
        vm.warp(block.timestamp + 1 days);
    }

    function proposeBet() internal returns (uint256) {
        vm.prank(alice);
        return book.proposeBet(bob, "Lakers beat Celtics", 2, "coffee", uint64(block.timestamp + 7 days));
    }

    function activeBet() internal returns (uint256 id) {
        id = proposeBet();
        vm.prank(bob);
        book.acceptBet(id);
    }

    function claimedBet(BetBook.Outcome o) internal returns (uint256 id) {
        id = activeBet();
        vm.prank(alice);
        book.claimOutcome(id, o);
    }

    /// Resolved by mutual agreement, alice (maker) the winner.
    function resolvedBet() internal returns (uint256 id) {
        id = claimedBet(BetBook.Outcome.MakerWins);
        vm.prank(bob);
        book.respondToClaim(id, BetBook.Outcome.MakerWins);
    }

    function disputedBet() internal returns (uint256 id) {
        id = claimedBet(BetBook.Outcome.MakerWins);
        vm.prank(bob);
        book.respondToClaim(id, BetBook.Outcome.TakerWins);
    }

    function assertStatus(uint256 id, BetBook.Status s) internal view {
        assertEq(uint8(book.getBet(id).status), uint8(s));
    }

    function assertOutcome(uint256 id, BetBook.Outcome o) internal view {
        assertEq(uint8(book.getBet(id).outcome), uint8(o));
    }
}
