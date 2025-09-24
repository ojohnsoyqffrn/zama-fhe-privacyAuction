import React, { useEffect, useState } from "react";
import { getContractReadOnly, normAddr, ABI, config } from "./contract";
import { 
  FaClock, FaTrophy, FaMoneyBillWave, FaChartLine, FaList, 
  FaPlus, FaLock, FaLockOpen, FaEye, FaEyeSlash, FaUser, 
  FaFire, FaHistory, FaCoins, FaUsers, FaChartBar, FaTimes
} from "react-icons/fa";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import { ethers } from "ethers";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import "./App.css"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Auction {
  id: number;
  creator: string;
  item: string;
  description: string;
  deadline: number;
  terminated: boolean;
  winner: string;
  highestBid: number;
  lowestBid: number;
  bidCount: number;
  averageBid: number;
}

export default function App() {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [biddingAuctionId, setBiddingAuctionId] = useState<number | null>(null);
  const [biddingAmount, setBiddingAmount] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [userAuctions, setUserAuctions] = useState<Auction[]>([]);
  const [userBids, setUserBids] = useState<number>(0);
  const [userWins, setUserWins] = useState<number>(0);
  const [showBidModal, setShowBidModal] = useState(false);
  const [currentAuction, setCurrentAuction] = useState<Auction | null>(null);

  const diagnoseNetwork = async () => {
    try {
      if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
        return false;
      }
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n) {
        return false;
      }
      
      const code = await provider.getCode(config.contractAddress);
      if (code === "0x") {
        return false;
      }
      
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length === 0) {
        return false;
      }
      
      const contract = new ethers.Contract(
        config.contractAddress,
        ABI,
        provider
      );
      
      return true; 
    } catch (error) {
      return false; 
    }
  };

  useEffect(() => {
    diagnoseNetwork().then(() => {
      loadAuctions().finally(() => setLoading(false));
    });
  }, []);


  useEffect(() => {
    if (account && auctions.length > 0) {

      const userAuctions = auctions.filter(a => 
        a.creator === account || a.winner === account
      );
      setUserAuctions(userAuctions);

      const bids = auctions.reduce((sum, a) => {
        return sum + (a.creator === account || a.winner === account ? 1 : 0);
      }, 0);
      setUserBids(bids);
      
      const wins = auctions.filter(a => a.winner === account).length;
      setUserWins(wins);
    }
  }, [account, auctions]);

  const checkIsCreator = (addr: string, auctionCreator: string) => {
    return normAddr(addr) === normAddr(auctionCreator);
  };

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      console.error("Failed to connect wallet", e);
      alert("Failed to connect wallet: " + e);
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // ----------------- Load Auctions -----------------
  const loadAuctions = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const nextId = Number(await contract.nextAuctionId());
      const list: Auction[] = [];
      
      for (let i = 0; i < nextId; i++) {
        try {
          const aRaw = await contract.auctions(i);
          const stats = await contract.getAuctionStats(i);
          
          list.push({
            id: i,
            creator: aRaw.creator,
            item: aRaw.item,
            description: aRaw.description,
            deadline: Number(aRaw.deadline),
            terminated: aRaw.terminated,
            winner: aRaw.winner,
            highestBid: Number(aRaw.highestBid),
            lowestBid: Number(stats[3]),
            bidCount: Number(stats[0]),
            averageBid: Number(stats[1]),
          });
        } catch (e) {
          console.warn(`Failed to load auction ${i}`, e);
        }
      }
      
      setAuctions(list);
    } catch (e) {
      console.error("Failed to load auctions", e);
    }
  };

  const createAuction = async (item: string, description: string, deadline: number) => {
    if (!item || !description) { 
      alert("Please enter item and description"); 
      return; 
    }
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.createAuction(item, description, deadline);
      await tx.wait();
      setShowCreateModal(false);
      await loadAuctions();
      alert("Auction created successfully!");
    } catch (e: any) {
      alert("Creation failed: " + (e?.message || e));
    } finally {
      setCreating(false);
    }
  };

  const placeBid = async (auctionId: number, amount: number) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.placeBid(auctionId, amount);
      await tx.wait();
      setShowBidModal(false);
      setBiddingAmount("");
      await loadAuctions();
      alert("Bid placed successfully!");
    } catch (e: any) {
      console.error("Bid failed", e);
      alert("Bid failed: " + (e?.message || e));
    }
  };

  const terminateAuction = async (auctionId: number) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    if (!window.confirm("Are you sure you want to terminate this auction? This will reveal the winner and prevent any further bids.")) {
      return;
    }
    
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.terminateAuction(auctionId);
      await tx.wait();
      await loadAuctions();
      alert("Auction terminated and winner revealed!");
    } catch (e: any) {
      console.error("Termination failed", e);
      alert("Termination failed: " + (e?.message || e));
    }
  };

  const getWinnerInfo = async (auctionId: number) => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const winnerInfo = await contract.getWinner(auctionId);
      alert(`Winner: ${winnerInfo[0]}\nWinning Bid: ${winnerInfo[1]} ETH`);
    } catch (e: any) {
      alert("Failed to get winner info: " + (e?.message || e));
    }
  };

  const openBidModal = (auction: Auction) => {
    setCurrentAuction(auction);
    setShowBidModal(true);
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading blockchain data...</p>
    </div>
  );

  // Filter auctions based on active tab
  const filteredAuctions = auctions.filter(auction => {
    if (activeTab === "all") return true;
    if (activeTab === "active") return !auction.terminated && auction.deadline * 1000 > Date.now();
    if (activeTab === "completed") return auction.terminated;
    return true;
  });

  // ----------------- Aggregate Stats -----------------
  const totalAuctions = auctions.length;
  const totalBids = auctions.reduce((sum, a) => sum + a.bidCount, 0);
  const activeAuctions = auctions.filter(a => !a.terminated && a.deadline * 1000 > Date.now()).length;
  const totalVolume = auctions.reduce((sum, a) => sum + a.highestBid, 0);

  // Chart data for auction stats
  const chartData = {
    labels: auctions.slice(0, 5).map(a => a.item),
    datasets: [
      {
        label: 'Lowest Bid (ETH)',
        data: auctions.slice(0, 5).map(a => a.lowestBid),
        backgroundColor: 'rgba(138, 43, 226, 0.6)',
        borderColor: 'rgba(138, 43, 226, 1)',
        borderWidth: 1,
      },
      {
        label: 'Average Bid (ETH)',
        data: auctions.slice(0, 5).map(a => a.averageBid),
        backgroundColor: 'rgba(0, 191, 255, 0.6)',
        borderColor: 'rgba(0, 191, 255, 1)',
        borderWidth: 1,
      },
    ],
  };

  return (
    <div className="app-container">
      {/* Animated background elements */}
      <div className="bg-particles">
        {[...Array(15)].map((_, i) => <div key={i} className="particle"></div>)}
      </div>

      {/* Navbar */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"></div>
          <h1>Zama<span>Privacy</span>Auction</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-auction-btn"
          >
            <FaPlus /> New Auction
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Dashboard Section */}
        <section className="dashboard-section">
          <div className="dashboard-stats">
            <div className="stat-card">
              <div className="stat-icon">
                <FaCoins />
              </div>
              <div className="stat-content">
                <h3>Total Volume</h3>
                <p>{totalVolume.toFixed(2)} ETH</p>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">
                <FaList />
              </div>
              <div className="stat-content">
                <h3>Total Auctions</h3>
                <p>{totalAuctions}</p>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">
                <FaUsers />
              </div>
              <div className="stat-content">
                <h3>Active Auctions</h3>
                <p>{activeAuctions}</p>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">
                <FaChartBar />
              </div>
              <div className="stat-content">
                <h3>Total Bids</h3>
                <p>{totalBids}</p>
              </div>
            </div>
          </div>
          
          <div className="dashboard-chart">
            <h2>
              <FaChartLine /> Auction Statistics
            </h2>
            <div className="chart-container">
              <Bar data={chartData} options={{ 
                responsive: true,
                plugins: {
                  legend: {
                    position: 'top',
                    labels: {
                      color: '#fff'
                    }
                  },
                  title: {
                    display: true,
                    text: 'Top Auctions',
                    color: '#fff'
                  }
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      color: '#aaa'
                    },
                    grid: {
                      color: 'rgba(255,255,255,0.1)'
                    }
                  },
                  x: {
                    ticks: {
                      color: '#aaa'
                    },
                    grid: {
                      color: 'rgba(255,255,255,0.1)'
                    }
                  }
                }
              }} />
            </div>
          </div>
        </section>
        
        {/* User Profile Section */}
        {account && (
          <section className="user-section">
            <div className="user-header">
              <div className="user-avatar">
                <FaUser />
              </div>
              <div className="user-info">
                <h2>{account.substring(0, 6)}...{account.substring(account.length - 4)}</h2>
                <p>Web3 Auction Participant</p>
              </div>
            </div>
            
            <div className="user-stats">
              <div className="user-stat">
                <h3>Auctions Created</h3>
                <p>{userAuctions.filter(a => a.creator === account).length}</p>
              </div>
              <div className="user-stat">
                <h3>Bids Placed</h3>
                <p>{userBids}</p>
              </div>
              <div className="user-stat">
                <h3>Auctions Won</h3>
                <p>{userWins}</p>
              </div>
            </div>
          </section>
        )}
        
        {/* Hot Auctions Section */}
        <section className="hot-auctions">
          <div className="section-header">
            <h2><FaFire /> Hot Auctions</h2>
            <p>Most active auctions with highest participation</p>
          </div>
          
          <div className="hot-auctions-grid">
            {auctions
              .filter(a => !a.terminated)
              .sort((a, b) => b.bidCount - a.bidCount)
              .slice(0, 3)
              .map(auction => (
                <div key={auction.id} className="hot-auction-card">
                  <div className="hot-auction-header">
                    <h3>{auction.item}</h3>
                    <span className="hot-badge">HOT</span>
                  </div>
                  <p className="hot-auction-desc">{auction.description.substring(0, 80)}...</p>
                  <div className="hot-auction-stats">
                    <div className="hot-stat">
                      <span>Lowest Bid</span>
                      <strong>{auction.lowestBid} ETH</strong>
                    </div>
                    <div className="hot-stat">
                      <span>Average Bid</span>
                      <strong>{auction.averageBid.toFixed(4)} ETH</strong>
                    </div>
                    <div className="hot-stat">
                      <span>Time Left</span>
                      <strong>
                        {Math.floor((auction.deadline * 1000 - Date.now()) / (1000 * 60 * 60))}h
                      </strong>
                    </div>
                  </div>
                  <button 
                    onClick={() => openBidModal(auction)} 
                    className="bid-hot-btn"
                  >
                    Place Bid
                  </button>
                </div>
              ))
            }
          </div>
        </section>
        
        {/* Auction Tabs */}
        <div className="auction-tabs">
          {[
            { id: "all", label: "All Auctions", icon: <FaList /> },
            { id: "active", label: "Active", icon: <FaFire /> },
            { id: "completed", label: "Completed", icon: <FaHistory /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        
        {/* Auctions Grid */}
        <div className="auctions-grid">
          {filteredAuctions.length === 0 ? (
            <div className="no-auctions">
              <h3>No auctions found</h3>
              <p>Create the first auction to get started!</p>
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="create-first-btn"
              >
                Create First Auction
              </button>
            </div>
          ) : (
            filteredAuctions.map(auction => {
              const isCreator = account && checkIsCreator(account, auction.creator);
              const isActive = !auction.terminated && auction.deadline * 1000 > Date.now();
              const isCompleted = auction.terminated;
              const isWinner = account && auction.winner === account;
              
              return (
                <div key={auction.id} className={`auction-card ${isWinner ? 'winner' : ''}`}>
                  <div className="auction-header">
                    <div>
                      <h3>{auction.item}</h3>
                      <p className="creator">
                        by {auction.creator.substring(0, 6)}...{auction.creator.substring(auction.creator.length - 4)}
                      </p>
                    </div>
                    <div className={`status-badge ${isCompleted ? 'completed' : isActive ? 'active' : 'closed'}`}>
                      {isCompleted ? "COMPLETED" : isActive ? "ACTIVE" : "CLOSED"}
                    </div>
                  </div>
                  
                  {/* 优化描述显示 - 添加行数限制 */}
                  <div className="auction-desc-container">
                    <p className="auction-desc">{auction.description}</p>
                  </div>
                  
                  <div className="auction-stats">
                    <div className="stat">
                      <FaClock size={14} />
                      <span>{new Date(auction.deadline * 1000).toLocaleString()}</span>
                    </div>
                    <div className="stat">
                      <FaMoneyBillWave size={14} />
                      <span>{auction.bidCount} bids</span>
                    </div>
                    <div className="stat">
                      <FaChartLine size={14} />
                      <span>Avg: {auction.averageBid.toFixed(4)} ETH</span>
                    </div>
                  </div>
                  
                  {isCompleted && auction.winner && (
                    <div className="winner-info">
                      <FaTrophy />
                      <div>
                        <span>Winner: {auction.winner.substring(0, 6)}...{auction.winner.substring(auction.winner.length - 4)}</span>
                        <strong>{auction.highestBid} ETH</strong>
                      </div>
                      <button 
                        onClick={() => getWinnerInfo(auction.id)}
                        className="details-btn"
                      >
                        Details
                      </button>
                    </div>
                  )}
                  
                  {isActive && (
                    <div className="active-notice">
                      <FaEyeSlash size={14} />
                      <span>Bidding details will be revealed after completion</span>
                    </div>
                  )}
                  
                  <div className="auction-actions">
                    {isActive && account && (
                      <button 
                        onClick={() => openBidModal(auction)} 
                        className="bid-btn"
                      >
                        Place Bid
                      </button>
                    )}
                    
                    {isCreator && isActive && (
                      <button 
                        onClick={() => terminateAuction(auction.id)}
                        className="terminate-btn"
                      >
                        <FaLock size={12} /> Terminate
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <ModalCreate 
          onCreate={createAuction} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
        />
      )}
      
      {showBidModal && currentAuction && (
        <ModalBid 
          auction={currentAuction}
          onBid={(amount) => placeBid(currentAuction.id, amount)}
          onClose={() => setShowBidModal(false)}
          biddingAmount={biddingAmount}
          setBiddingAmount={setBiddingAmount}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}

      <footer className="app-footer">
        <p>Zama Privacy Auction &copy; {new Date().getFullYear()} - Built on Ethereum</p>
        <div className="footer-links">
          <a href="#">Docs</a>
          <a href="#">GitHub</a>
          <a href="#">Twitter</a>
          <a href="#">Discord</a>
        </div>
      </footer>
    </div>
  );
}

// ------------------- Create Auction Modal -------------------
function ModalCreate({ onCreate, onClose, creating }: { 
  onCreate: (item: string, description: string, deadline: number) => void; 
  onClose: () => void; 
  creating: boolean; 
}) {
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [minDate, setMinDate] = useState("");

  useEffect(() => {
    // 设置最小日期为当前时间
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
    setMinDate(localISOTime);
  }, []);

  const handleSubmit = () => {
    const deadlineTimestamp = Math.floor(new Date(deadline).getTime() / 1000);
    if (!item || !description || !deadline || isNaN(deadlineTimestamp)) {
      alert("Please fill all fields with valid values");
      return;
    }
    onCreate(item, description, deadlineTimestamp);
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Auction</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Item Name</label>
            <input 
              value={item} 
              onChange={e => setItem(e.target.value)} 
              placeholder="Auction item name" 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              placeholder="Item description" 
              rows={4}
              className="form-textarea"
            />
          </div>
          
          <div className="form-group">
            <label>Bidding Deadline</label>
            <div className="datetime-picker">
              <input 
                type="datetime-local" 
                value={deadline} 
                onChange={e => setDeadline(e.target.value)} 
                min={minDate}
                className="form-input"
              />
              <button 
                className="set-now-btn"
                onClick={() => {
                  const now = new Date();
                  const offset = now.getTimezoneOffset() * 60000;
                  const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
                  setDeadline(localISOTime);
                }}
              >
                Now
              </button>
              <button 
                className="set-tomorrow-btn"
                onClick={() => {
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  const offset = tomorrow.getTimezoneOffset() * 60000;
                  const localISOTime = (new Date(tomorrow.getTime() - offset)).toISOString().slice(0, 16);
                  setDeadline(localISOTime);
                }}
              >
                Tomorrow
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="create-btn"
          >
            {creating ? "Creating..." : "Create Auction"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------- Bid Modal -------------------
function ModalBid({ 
  auction, 
  onBid, 
  onClose, 
  biddingAmount, 
  setBiddingAmount 
}: { 
  auction: Auction;
  onBid: (amount: number) => void;
  onClose: () => void;
  biddingAmount: string;
  setBiddingAmount: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <div className="modal-overlay">
      <div className="bid-modal">
        <div className="modal-header">
          <h2>Place Bid on {auction.item}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="auction-info">
            <p>{auction.description}</p>
            <div className="auction-stats">
              <div className="stat">
                <FaClock size={14} />
                <span>Deadline: {new Date(auction.deadline * 1000).toLocaleString()}</span>
              </div>
              <div className="stat">
                <FaMoneyBillWave size={14} />
                <span>Lowest Bid: {auction.lowestBid} ETH</span>
              </div>
              <div className="stat">
                <FaChartLine size={14} />
                <span>Average Bid: {auction.averageBid.toFixed(4)} ETH</span>
              </div>
            </div>
          </div>
          
          <div className="form-group">
            <label>Your Bid Amount (ETH)</label>
            <input 
              type="number" 
              value={biddingAmount} 
              onChange={e => setBiddingAmount(e.target.value)} 
              placeholder="Enter bid amount" 
              step="0.001"
              min="0.001"
              className="form-input"
            />
            <div className="suggested-bids">
              <button onClick={() => setBiddingAmount((auction.lowestBid * 1.05).toFixed(3))}>
                +5% ({auction.lowestBid > 0 ? (auction.lowestBid * 1.05).toFixed(3) : "0.001"})
              </button>
              <button onClick={() => setBiddingAmount((auction.lowestBid * 1.1).toFixed(3))}>
                +10% ({auction.lowestBid > 0 ? (auction.lowestBid * 1.1).toFixed(3) : "0.001"})
              </button>
              <button onClick={() => setBiddingAmount((auction.lowestBid * 1.2).toFixed(3))}>
                +20% ({auction.lowestBid > 0 ? (auction.lowestBid * 1.2).toFixed(3) : "0.001"})
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={() => onBid(Number(biddingAmount))}
            disabled={!biddingAmount || Number(biddingAmount) <= 0}
            className="bid-btn"
          >
            Place Bid
          </button>
        </div>
      </div>
    </div>
  );
}