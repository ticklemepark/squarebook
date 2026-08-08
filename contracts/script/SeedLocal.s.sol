// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {BetBook} from "../src/BetBook.sol";

// anvil's default funded accounts — local dev only, publicly known keys
uint256 constant PK_TIMOTHY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
uint256 constant PK_ALEX = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
uint256 constant PK_SAM = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
uint256 constant PK_PRIYA = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;

address constant TIMOTHY = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
address constant ALEX = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
address constant SAM = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
address constant PRIYA = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

/// Step 1: deploy with the four dev personas as members.
/// Run on a FRESH anvil so the contract lands at the deterministic address
/// 0x5FbDB2315678afecb367f032d93F642f64180aa3 (first tx from account #0).
contract SeedDeploy is Script {
    function run() external {
        address[] memory addrs = new address[](4);
        string[] memory names = new string[](4);
        (addrs[0], names[0]) = (TIMOTHY, "Timothy");
        (addrs[1], names[1]) = (ALEX, "Alex");
        (addrs[2], names[2]) = (SAM, "Sam");
        (addrs[3], names[3]) = (PRIYA, "Priya");
        vm.startBroadcast(PK_TIMOTHY);
        new BetBook(addrs, names);
        vm.stopBroadcast();
    }
}

/// Step 2 (run after advancing anvil's clock so the vote-eligibility
/// snapshot joinedAt < disputedAt holds): bets in every interesting state.
contract SeedBets is Script {
    BetBook constant book = BetBook(0x5FbDB2315678afecb367f032d93F642f64180aa3);

    function later() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function run() external {
        // id 0: Proposed — waiting on Alex
        // id 1: Claimed — Timothy claims he won vs Priya
        // id 2: Resolved unpaid — Timothy won 3 coffee vs Alex (double-eligible)
        vm.startBroadcast(PK_TIMOTHY);
        book.proposeBet(ALEX, "Lakers beat Celtics on Friday", 2, "coffee", later());
        book.proposeBet(PRIYA, "Priya can't do 20 pullups", 1, "dinner", later());
        book.proposeBet(ALEX, "Alex shows up late to game night", 3, "coffee", later());
        vm.stopBroadcast();

        // id 3: Active — Alex vs Sam marathon bet
        vm.startBroadcast(PK_ALEX);
        book.proposeBet(SAM, "Sam finishes the marathon under 4h", 20, "USD", later());
        book.acceptBet(2);
        vm.stopBroadcast();

        // id 4: will become Disputed
        vm.startBroadcast(PK_SAM);
        book.acceptBet(3);
        book.proposeBet(ALEX, "Alex chickens out of the karaoke dare", 1, "dessert", later());
        vm.stopBroadcast();

        // id 5: will become Settled
        vm.startBroadcast(PK_PRIYA);
        book.acceptBet(1);
        book.proposeBet(SAM, "Sam burns the toast at brunch", 1, "coffee", later());
        vm.stopBroadcast();

        vm.startBroadcast(PK_TIMOTHY);
        book.claimOutcome(1, BetBook.Outcome.MakerWins);
        book.claimOutcome(2, BetBook.Outcome.MakerWins);
        vm.stopBroadcast();

        vm.startBroadcast(PK_ALEX);
        book.respondToClaim(2, BetBook.Outcome.MakerWins); // id 2 resolved, unpaid
        book.acceptBet(4);
        vm.stopBroadcast();

        vm.startBroadcast(PK_SAM);
        book.claimOutcome(4, BetBook.Outcome.MakerWins);
        vm.stopBroadcast();
        vm.startBroadcast(PK_ALEX);
        book.respondToClaim(4, BetBook.Outcome.TakerWins); // id 4 disputed
        vm.stopBroadcast();
        vm.startBroadcast(PK_TIMOTHY);
        book.vote(4, BetBook.Outcome.MakerWins);
        vm.stopBroadcast();

        vm.startBroadcast(PK_SAM);
        book.acceptBet(5);
        book.claimOutcome(5, BetBook.Outcome.MakerWins); // sam concedes the toast
        vm.stopBroadcast();
        vm.startBroadcast(PK_PRIYA);
        book.respondToClaim(5, BetBook.Outcome.MakerWins);
        book.markSettled(5); // id 5 settled
        vm.stopBroadcast();

        // id 6: Sam beat Timothy at chess (resolved), id 7: pending double-or-nothing offer
        vm.startBroadcast(PK_SAM);
        book.proposeBet(TIMOTHY, "Timothy loses the chess match", 2, "coffee", later());
        vm.stopBroadcast();
        vm.startBroadcast(PK_TIMOTHY);
        book.acceptBet(6);
        book.claimOutcome(6, BetBook.Outcome.MakerWins); // Timothy concedes
        vm.stopBroadcast();
        vm.startBroadcast(PK_SAM);
        book.respondToClaim(6, BetBook.Outcome.MakerWins);
        book.proposeDoubleOrNothing(6, "Chess rematch, best of three", later());
        vm.stopBroadcast();
    }
}
