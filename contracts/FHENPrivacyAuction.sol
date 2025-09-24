// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Privacy-Preserving Auction Contract using FHE
/// @notice Allows encrypted bidding with automatic winner determination and statistics calculation
contract FHENPrivacyAuction is SepoliaConfig {
    // ------------------------------------------------------------------------
    // Data structures
    // ------------------------------------------------------------------------

    struct Auction {
        address creator;
        string item;            // Auction item name
        string description;     // Item description
        uint256 deadline;       // Bidding end time
        bool terminated;        // Auction termination status
        
        // State flags
        bool decryptionPending; // Decryption in progress
        bool winnerDeclared;    // Winner declared status
        
        // Encrypted statistics
        euint32 highestBidEncrypted; // Highest encrypted bid
        euint32 lowestBidEncrypted;  // Lowest encrypted bid
        euint32 sumBidsEncrypted;    // Sum of all encrypted bids
        
        // Plaintext statistics (revealed after decryption)
        uint32 highestBidPlain; // Highest bid amount
        uint32 lowestBidPlain;  // Lowest bid amount
        uint32 averageBidPlain; // Average bid amount
        
        // Participants info
        uint256 bidCount;       // Number of bids placed
        address winner;         // Auction winner (highest bidder)
    }

    struct EncryptedBid {
        address bidder;         // Bidder address
        euint32 amount;         // Encrypted bid amount
    }

    // ------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------

    uint256 public nextAuctionId;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => EncryptedBid[]) public auctionBids;

    // Request ID mapping for decryption callbacks
    mapping(uint256 => uint256) private requestToAuctionPlusOne;

    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------

    event AuctionCreated(uint256 indexed auctionId, address indexed creator, uint256 deadline);
    event EncryptedBidPlaced(uint256 indexed auctionId, address indexed bidder);
    event AuctionTerminated(uint256 indexed auctionId, address indexed terminator);
    event WinnerDeclared(
        uint256 indexed auctionId,
        address winner,
        uint32 highestBid,
        uint32 lowestBid,
        uint32 averageBid,
        uint256 bidCount
    );

    // ------------------------------------------------------------------------
    // Auction creation
    // ------------------------------------------------------------------------

    /// @notice Creates a new auction
    /// @param _item Auction item name
    /// @param _description Item description
    /// @param _deadline Bidding end timestamp
    function createAuction(
        string calldata _item,
        string calldata _description,
        uint256 _deadline
    ) external returns (uint256 auctionId) {
        require(_deadline > block.timestamp, "Deadline must be in future");

        auctionId = nextAuctionId++;
        Auction storage a = auctions[auctionId];
        a.creator = msg.sender;
        a.item = _item;
        a.description = _description;
        a.deadline = _deadline;
        
        // Initialize encrypted values
        a.lowestBidEncrypted = FHE.asEuint32(type(uint32).max);
        a.highestBidEncrypted = FHE.asEuint32(0);
        a.sumBidsEncrypted = FHE.asEuint32(0);

        emit AuctionCreated(auctionId, msg.sender, _deadline);
    }

    // ------------------------------------------------------------------------
    // Bidding operations
    // ------------------------------------------------------------------------

    /// @notice Places an encrypted bid on an active auction
    /// @param auctionId ID of the auction
    /// @param encInput Externally encrypted bid amount
    /// @param inputProof Zero-knowledge proof of encryption
    function placeEncryptedBid(
        uint256 auctionId,
        externalEuint32 encInput,
        bytes calldata inputProof
    ) external {
        Auction storage a = auctions[auctionId];
        require(!a.terminated, "Auction terminated");
        require(block.timestamp < a.deadline, "Deadline passed");
        require(!a.winnerDeclared, "Winner declared");

        // Convert external to internal encrypted value
        euint32 encBid = FHE.fromExternal(encInput, inputProof);

        // Store encrypted bid
        auctionBids[auctionId].push(EncryptedBid(msg.sender, encBid));
        a.bidCount++;

        // Update encrypted statistics
        a.sumBidsEncrypted = FHE.add(a.sumBidsEncrypted, encBid);
        
        // Update highest bid
        ebool isHigher = FHE.gt(encBid, a.highestBidEncrypted);
        a.highestBidEncrypted = FHE.select(isHigher, encBid, a.highestBidEncrypted);
        
        // Update lowest bid
        ebool isLower = FHE.lt(encBid, a.lowestBidEncrypted);
        a.lowestBidEncrypted = FHE.select(isLower, encBid, a.lowestBidEncrypted);

        // Allow access for future decryption
        FHE.allowThis(a.sumBidsEncrypted);
        FHE.allowThis(a.highestBidEncrypted);
        FHE.allowThis(a.lowestBidEncrypted);

        emit EncryptedBidPlaced(auctionId, msg.sender);
    }

    // ------------------------------------------------------------------------
    // Auction termination
    // ------------------------------------------------------------------------

    /// @notice Terminates auction manually before deadline
    /// @param auctionId ID of the auction to terminate
    function terminateAuction(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        require(msg.sender == a.creator, "Only creator can terminate");
        require(!a.terminated, "Already terminated");
        require(!a.winnerDeclared, "Winner declared");
        
        a.terminated = true;
        emit AuctionTerminated(auctionId, msg.sender);
    }

    // ------------------------------------------------------------------------
    // Winner declaration and decryption
    // ------------------------------------------------------------------------

    /// @notice Initiates winner determination process
    /// @param auctionId ID of the auction to finalize
    function declareWinner(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        require(!a.winnerDeclared, "Winner already declared");
        require(a.terminated || block.timestamp >= a.deadline, "Auction still active");
        require(!a.decryptionPending, "Decryption in progress");

        // Handle case with no bids
        if (a.bidCount == 0) {
            a.winnerDeclared = true;
            emit WinnerDeclared(auctionId, address(0), 0, 0, 0, 0);
            return;
        }

        // Prepare encrypted bids for decryption
        bytes32[] memory ciphers = new bytes32[](a.bidCount);
        for (uint256 i = 0; i < a.bidCount; i++) {
            ciphers[i] = FHE.toBytes32(auctionBids[auctionId][i].amount);
        }

        // Request decryption from FHE network
        uint256 reqId = FHE.requestDecryption(ciphers, this.callbackDeclareWinner.selector);
        requestToAuctionPlusOne[reqId] = auctionId + 1;
        a.decryptionPending = true;
    }

    /// @notice Callback for processing decrypted bids and determining winner
    /// @param requestId Decryption request ID
    /// @param cleartexts Decrypted bid values
    /// @param proof Zero-knowledge proof of decryption
    function callbackDeclareWinner(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 stored = requestToAuctionPlusOne[requestId];
        require(stored != 0, "Invalid request ID");
        uint256 auctionId = stored - 1;
        
        Auction storage a = auctions[auctionId];
        require(a.decryptionPending, "No pending decryption");

        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Process decrypted bids
        uint32[] memory bids = abi.decode(cleartexts, (uint32[]));
        uint32 maxBid = 0;
        uint32 minBid = type(uint32).max;
        uint32 sum = 0;
        uint256 winnerIndex = 0;

        for (uint256 i = 0; i < bids.length; i++) {
            uint32 bidValue = bids[i];
            sum += bidValue;
            
            if (bidValue > maxBid) {
                maxBid = bidValue;
                winnerIndex = i;
            }
            
            if (bidValue < minBid) {
                minBid = bidValue;
            }
        }

        // Calculate statistics
        a.highestBidPlain = maxBid;
        a.lowestBidPlain = minBid;
        a.averageBidPlain = bids.length > 0 ? sum / uint32(bids.length) : 0;
        a.winner = auctionBids[auctionId][winnerIndex].bidder;

        // Finalize auction state
        a.winnerDeclared = true;
        a.decryptionPending = false;
        delete requestToAuctionPlusOne[requestId];

        emit WinnerDeclared(
            auctionId,
            a.winner,
            a.highestBidPlain,
            a.lowestBidPlain,
            a.averageBidPlain,
            a.bidCount
        );
    }

    // ------------------------------------------------------------------------
    // Statistics access
    // ------------------------------------------------------------------------

    /// @notice Retrieves auction statistics after winner declaration
    /// @param auctionId ID of the auction
    /// @return bidCount Number of bids
    /// @return averageBid Average bid amount
    /// @return highestBid Highest bid amount
    /// @return lowestBid Lowest bid amount
    /// @return winner Address of auction winner
    function getAuctionStats(uint256 auctionId)
        external
        view
        returns (
            uint256 bidCount,
            uint32 averageBid,
            uint32 highestBid,
            uint32 lowestBid,
            address winner
        )
    {
        Auction storage a = auctions[auctionId];
        require(a.winnerDeclared, "Winner not declared");
        return (
            a.bidCount,
            a.averageBidPlain,
            a.highestBidPlain,
            a.lowestBidPlain,
            a.winner
        );
    }
}