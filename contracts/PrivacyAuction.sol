// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Privacy Auction Contract
/// @notice Allows users to create auction items, place bids, and reveals auction statistics upon termination
contract PrivacyAuction {
    struct Auction {
        address creator;
        string item;            // Auction item name
        string description;     // Item description
        uint256 deadline;       // Bidding end time
        bool terminated;        // Auction termination status
        address winner;         // Highest bidder
        uint256 highestBid;     // Highest bid amount
        uint256 lowestBid;      // Lowest bid amount
        uint256 sumBids;        // Sum of all bids
        uint256 bidCount;       // Number of bids placed
        uint256 highestBidIndex; // Index of highest bid in bids array
    }

    struct Bid {
        address bidder;
        uint256 amount;
    }

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => Bid[]) public auctionBids;

    uint256 public nextAuctionId;

    event AuctionCreated(uint256 indexed auctionId, address indexed creator, uint256 deadline);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionTerminated(uint256 indexed auctionId, address indexed terminator);
    event WinnerDeclared(uint256 indexed auctionId, address indexed winner, uint256 winningBid);

    /// @notice Creates a new auction
    /// @param _item Name of the auction item
    /// @param _description Description of the item
    /// @param _deadline Auction end timestamp
    function createAuction(
        string calldata _item,
        string calldata _description,
        uint256 _deadline
    ) external returns (uint256 auctionId) {
        require(_deadline > block.timestamp, "Deadline must be in the future");

        auctionId = nextAuctionId;
        Auction storage a = auctions[auctionId];
        a.creator = msg.sender;
        a.item = _item;
        a.description = _description;
        a.deadline = _deadline;
        a.lowestBid = type(uint256).max; // Initialize with max value
        a.highestBid = 0;

        nextAuctionId++;
        emit AuctionCreated(auctionId, msg.sender, _deadline);
    }

    /// @notice Places a bid on an active auction
    /// @param auctionId ID of the auction
    /// @param amount Bid amount
    function placeBid(uint256 auctionId, uint256 amount) external {
        Auction storage a = auctions[auctionId];
        require(!a.terminated, "Auction terminated");
        require(block.timestamp < a.deadline, "Deadline passed");
        require(amount > 0, "Bid must be >0");

        // Add bid to auction records
        auctionBids[auctionId].push(Bid(msg.sender, amount));

        // Update auction statistics
        a.bidCount++;
        a.sumBids += amount;
        
        if (amount < a.lowestBid) {
            a.lowestBid = amount;
        }
        
        if (amount > a.highestBid) {
            a.highestBid = amount;
            a.highestBidIndex = auctionBids[auctionId].length - 1;
        }

        emit BidPlaced(auctionId, msg.sender, amount);
    }

    /// @notice Terminates auction and declares winner
    /// @param auctionId ID of the auction to terminate
    function terminateAuction(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        require(msg.sender == a.creator, "Only creator can terminate");
        require(!a.terminated, "Already terminated");

        a.terminated = true;
        emit AuctionTerminated(auctionId, msg.sender);

        if (a.bidCount > 0) {
            a.winner = auctionBids[auctionId][a.highestBidIndex].bidder;
            emit WinnerDeclared(auctionId, a.winner, a.highestBid);
        }
    }

    /// @notice Retrieves auction statistics
    /// @param auctionId ID of the auction
    /// @return participants Number of bidders
    /// @return averageBid Average bid amount
    /// @return highestBid Highest bid amount
    /// @return lowestBid Lowest bid amount
    function getAuctionStats(uint256 auctionId)
        external
        view
        returns (
            uint256 participants,
            uint256 averageBid,
            uint256 highestBid,
            uint256 lowestBid
        )
    {
        Auction storage a = auctions[auctionId];
        participants = a.bidCount;

        if (a.bidCount == 0) {
            return (0, 0, 0, type(uint256).max);
        }
        
        averageBid = a.sumBids / a.bidCount;
        highestBid = a.highestBid;
        lowestBid = a.lowestBid;
    }

    /// @notice Retrieves auction winner information
    /// @param auctionId ID of the auction
    /// @return winner Address of the winner
    /// @return winningBid Winning bid amount
    function getWinner(uint256 auctionId)
        external
        view
        returns (address winner, uint256 winningBid)
    {
        Auction storage a = auctions[auctionId];
        require(a.terminated, "Auction not terminated");
        return (a.winner, a.highestBid);
    }
}