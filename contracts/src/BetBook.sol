// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BetBook — a friend group's tamper-proof bet ledger
/// @notice Tracks bets, outcomes, and unpaid debts between members of one
///         friend group. No funds are held; stakes are quantities of
///         real-world units ("2 coffee", "20 USD") settled in person.
///         The contract's guarantee is that no one can unilaterally edit
///         results: outcomes require both parties to sign the same result,
///         or a majority vote of the group on dispute.
contract BetBook {
    enum Status {
        None,
        Proposed,
        Active,
        Claimed,
        Disputed,
        Resolved,
        Settled,
        Declined,
        Canceled,
        Superseded // a double-or-nothing child was accepted; debt rides on the child
    }

    enum Outcome {
        None,
        MakerWins,
        TakerWins,
        Push // tie / void — nothing owed
    }

    struct Member {
        string name;
        uint64 joinedAt;
        bool exists;
    }

    struct Bet {
        address maker;
        address taker;
        string description;
        uint32 stakeQty;
        string stakeUnit;
        uint64 acceptBy;
        uint64 claimedAt;
        uint64 disputedAt;
        Status status;
        Outcome claimedOutcome;
        address claimant;
        Outcome outcome;
        uint32 votesMaker;
        uint32 votesTaker;
        uint32 votesPush;
        uint256 parentId; // NO_BET unless this is a double-or-nothing child
        uint256 childId; // latest double-or-nothing child, NO_BET if none
        bool isDouble;
    }

    uint256 public constant NO_BET = type(uint256).max;
    uint64 public constant VOTE_WINDOW = 3 days;

    mapping(address => Member) public members;
    address[] public memberList;
    Bet[] internal bets;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event MemberAdded(address indexed member, address indexed addedBy, string name);
    event NameChanged(address indexed member, string name);
    event BetProposed(
        uint256 indexed id,
        address indexed maker,
        address indexed taker,
        string description,
        uint32 stakeQty,
        string stakeUnit,
        uint64 acceptBy,
        uint256 parentId
    );
    event BetAccepted(uint256 indexed id);
    event BetDeclined(uint256 indexed id);
    event BetCanceled(uint256 indexed id);
    event OutcomeClaimed(uint256 indexed id, address indexed claimant, Outcome outcome);
    event ClaimDisputed(uint256 indexed id, address indexed disputer, Outcome counterClaim);
    event VoteCast(uint256 indexed id, address indexed voter, Outcome outcome);
    event BetResolved(uint256 indexed id, Outcome outcome, bool byVote);
    event BetSettled(uint256 indexed id, address indexed markedBy); // markedBy == 0x0 for auto-settle
    event BetSuperseded(uint256 indexed parentId, uint256 indexed childId);
    event ParentRestored(uint256 indexed parentId, uint256 indexed childId);

    modifier onlyMember() {
        require(members[msg.sender].exists, "not a member");
        _;
    }

    constructor(address[] memory initialMembers, string[] memory names) {
        require(initialMembers.length == names.length, "length mismatch");
        require(initialMembers.length > 0, "no members");
        for (uint256 i = 0; i < initialMembers.length; i++) {
            _addMember(initialMembers[i], names[i], msg.sender);
        }
    }

    // ---------------------------------------------------------------- members

    function addMember(address who, string calldata name) external onlyMember {
        _addMember(who, name, msg.sender);
    }

    function _addMember(address who, string memory name, address addedBy) internal {
        require(who != address(0), "zero address");
        require(!members[who].exists, "already a member");
        require(bytes(name).length > 0, "empty name");
        members[who] = Member({name: name, joinedAt: uint64(block.timestamp), exists: true});
        memberList.push(who);
        emit MemberAdded(who, addedBy, name);
    }

    function setMyName(string calldata name) external onlyMember {
        require(bytes(name).length > 0, "empty name");
        members[msg.sender].name = name;
        emit NameChanged(msg.sender, name);
    }

    function memberCount() external view returns (uint256) {
        return memberList.length;
    }

    // -------------------------------------------------------------- lifecycle

    function proposeBet(
        address taker,
        string calldata description,
        uint32 stakeQty,
        string calldata stakeUnit,
        uint64 acceptBy
    ) external onlyMember returns (uint256) {
        return _propose(taker, description, stakeQty, stakeUnit, acceptBy, NO_BET);
    }

    /// @notice The winner of a resolved-but-unpaid bet offers a rematch:
    ///         win and the debt doubles, lose and both sides walk away clean.
    function proposeDoubleOrNothing(uint256 parentId, string calldata description, uint64 acceptBy)
        external
        onlyMember
        returns (uint256)
    {
        Bet storage parent = bets[parentId];
        require(parent.status == Status.Resolved, "parent not resolved");
        require(parent.outcome != Outcome.Push, "parent was a push");
        address winner = parent.outcome == Outcome.MakerWins ? parent.maker : parent.taker;
        address loser = parent.outcome == Outcome.MakerWins ? parent.taker : parent.maker;
        require(msg.sender == winner, "only winner");
        require(!_childLive(parent), "live child exists");

        uint256 id = _propose(loser, description, parent.stakeQty * 2, parent.stakeUnit, acceptBy, parentId);
        parent.childId = id;
        return id;
    }

    function _propose(
        address taker,
        string memory description,
        uint32 stakeQty,
        string memory stakeUnit,
        uint64 acceptBy,
        uint256 parentId
    ) internal returns (uint256) {
        require(members[taker].exists, "taker not a member");
        require(taker != msg.sender, "cannot bet yourself");
        require(stakeQty > 0, "zero stake");
        require(bytes(stakeUnit).length > 0, "empty unit");
        require(bytes(description).length > 0, "empty description");
        require(acceptBy > block.timestamp, "acceptBy in past");

        uint256 id = bets.length;
        Bet storage b = bets.push();
        b.maker = msg.sender;
        b.taker = taker;
        b.description = description;
        b.stakeQty = stakeQty;
        b.stakeUnit = stakeUnit;
        b.acceptBy = acceptBy;
        b.status = Status.Proposed;
        b.parentId = parentId;
        b.childId = NO_BET;
        b.isDouble = parentId != NO_BET;

        emit BetProposed(id, msg.sender, taker, description, stakeQty, stakeUnit, acceptBy, parentId);
        return id;
    }

    function acceptBet(uint256 id) external {
        Bet storage b = bets[id];
        require(msg.sender == b.taker, "only taker");
        require(b.status == Status.Proposed, "not proposed");
        require(block.timestamp <= b.acceptBy, "proposal expired");
        if (b.isDouble) {
            // parent may have been marked paid while the offer sat pending
            Bet storage parent = bets[b.parentId];
            require(parent.status == Status.Resolved, "parent no longer open");
            parent.status = Status.Superseded;
            emit BetSuperseded(b.parentId, id);
        }
        b.status = Status.Active;
        emit BetAccepted(id);
    }

    function declineBet(uint256 id) external {
        Bet storage b = bets[id];
        require(msg.sender == b.taker, "only taker");
        require(b.status == Status.Proposed, "not proposed");
        b.status = Status.Declined;
        emit BetDeclined(id);
    }

    function cancelBet(uint256 id) external {
        Bet storage b = bets[id];
        require(msg.sender == b.maker, "only maker");
        require(b.status == Status.Proposed, "not proposed");
        b.status = Status.Canceled;
        emit BetCanceled(id);
    }

    // ------------------------------------------------------------- resolution

    function claimOutcome(uint256 id, Outcome o) external {
        Bet storage b = bets[id];
        require(msg.sender == b.maker || msg.sender == b.taker, "not a party");
        require(b.status == Status.Active, "not active");
        require(o != Outcome.None, "no outcome");
        b.status = Status.Claimed;
        b.claimedOutcome = o;
        b.claimant = msg.sender;
        b.claimedAt = uint64(block.timestamp);
        emit OutcomeClaimed(id, msg.sender, o);
    }

    function respondToClaim(uint256 id, Outcome o) external {
        Bet storage b = bets[id];
        require(b.status == Status.Claimed, "no claim");
        require(msg.sender == b.maker || msg.sender == b.taker, "not a party");
        require(msg.sender != b.claimant, "claimant cannot respond");
        require(o != Outcome.None, "no outcome");
        if (o == b.claimedOutcome) {
            _resolve(id, o, false);
        } else {
            b.status = Status.Disputed;
            b.disputedAt = uint64(block.timestamp);
            emit ClaimDisputed(id, msg.sender, o);
        }
    }

    /// @notice A claimant whose counterparty goes silent can force the group vote.
    function escalate(uint256 id) external {
        Bet storage b = bets[id];
        require(b.status == Status.Claimed, "no claim");
        require(msg.sender == b.claimant, "only claimant");
        require(block.timestamp > b.claimedAt + VOTE_WINDOW, "too soon");
        b.status = Status.Disputed;
        b.disputedAt = uint64(block.timestamp);
        emit ClaimDisputed(id, msg.sender, b.claimedOutcome);
    }

    function vote(uint256 id, Outcome o) external onlyMember {
        Bet storage b = bets[id];
        require(b.status == Status.Disputed, "not disputed");
        require(msg.sender != b.maker && msg.sender != b.taker, "party cannot vote");
        // members added after the dispute opened cannot vote — blocks vote-packing
        require(members[msg.sender].joinedAt < b.disputedAt, "joined after dispute");
        require(!hasVoted[id][msg.sender], "already voted");
        require(o != Outcome.None, "no outcome");
        hasVoted[id][msg.sender] = true;
        if (o == Outcome.MakerWins) b.votesMaker++;
        else if (o == Outcome.TakerWins) b.votesTaker++;
        else b.votesPush++;
        emit VoteCast(id, msg.sender, o);
    }

    function finalizeVote(uint256 id) external {
        Bet storage b = bets[id];
        require(b.status == Status.Disputed, "not disputed");
        uint256 eligible = eligibleVoterCount(id);
        bool majority = b.votesMaker > eligible / 2 || b.votesTaker > eligible / 2 || b.votesPush > eligible / 2;
        require(majority || block.timestamp > b.disputedAt + VOTE_WINDOW, "vote still open");

        Outcome o = Outcome.Push; // ties and apathy void the bet
        if (b.votesMaker > b.votesTaker && b.votesMaker > b.votesPush) o = Outcome.MakerWins;
        else if (b.votesTaker > b.votesMaker && b.votesTaker > b.votesPush) o = Outcome.TakerWins;
        _resolve(id, o, true);
    }

    function eligibleVoterCount(uint256 id) public view returns (uint256 eligible) {
        Bet storage b = bets[id];
        for (uint256 i = 0; i < memberList.length; i++) {
            address m = memberList[i];
            if (m != b.maker && m != b.taker && members[m].joinedAt < b.disputedAt) eligible++;
        }
    }

    function _resolve(uint256 id, Outcome o, bool byVote) internal {
        Bet storage b = bets[id];
        b.status = Status.Resolved;
        b.outcome = o;
        emit BetResolved(id, o, byVote);

        if (b.isDouble) {
            if (o == Outcome.Push) {
                // rematch voided — the original debt stands again
                Bet storage parent = bets[b.parentId];
                parent.status = Status.Resolved;
                emit ParentRestored(b.parentId, id);
                _autoSettle(id);
            } else if (o == Outcome.TakerWins) {
                // taker is the original loser: debt wiped, nobody owes anything
                _autoSettle(id);
            }
            // MakerWins: original winner is now owed double; stays Resolved
            // until they mark it paid. Parent stays Superseded.
        } else if (o == Outcome.Push) {
            _autoSettle(id); // nothing owed, nothing to mark paid
        }
    }

    function _autoSettle(uint256 id) internal {
        bets[id].status = Status.Settled;
        emit BetSettled(id, address(0));
    }

    // ------------------------------------------------------------- settlement

    /// @notice Only the winner can clear a debt — the creditor is the only
    ///         party with no incentive to falsely mark it paid.
    function markSettled(uint256 id) external {
        Bet storage b = bets[id];
        require(b.status == Status.Resolved, "not resolved");
        address winner = b.outcome == Outcome.MakerWins ? b.maker : b.taker;
        require(msg.sender == winner, "only winner");
        b.status = Status.Settled;
        emit BetSettled(id, msg.sender);
    }

    // ------------------------------------------------------------------ views

    function betCount() external view returns (uint256) {
        return bets.length;
    }

    function getBet(uint256 id) external view returns (Bet memory) {
        return bets[id];
    }

    function _childLive(Bet storage parent) internal view returns (bool) {
        if (parent.childId == NO_BET) return false;
        Bet storage child = bets[parent.childId];
        if (child.status == Status.Declined || child.status == Status.Canceled) return false;
        if (child.status == Status.Proposed && block.timestamp > child.acceptBy) return false;
        return true;
    }
}
