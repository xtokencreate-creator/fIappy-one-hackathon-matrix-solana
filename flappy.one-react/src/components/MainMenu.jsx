import { useEffect, useState, useRef } from 'react';
import PrivyLoginButton from './PrivyLoginButton';
import PrivyAddFundsButton from './PrivyAddFundsButton';
import { useWallets } from '@privy-io/react-auth/solana';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BIRD_TYPES, BET_AMOUNTS } from '../config/gameConfig';
import './MainMenu.css';

// Mock data for leaderboard and cashouts
const MOCK_LEADERBOARD = [
  { rank: 1, name: 'FlappyKing', amount: 15234.50 },
  { rank: 2, name: 'BirdMaster', amount: 12891.20 },
  { rank: 3, name: 'PipeDodger', amount: 9445.80 },
];

const MOCK_CASHOUTS = [
  { name: 'Nefarious', amount: 45.20 },
  { name: 'Quantum', amount: 31.50 },
  { name: 'Pow34r', amount: 18.90 },
];

function MainMenu({
  username,
  setUsername,
  selectedBet,
  setSelectedBet,
  selectedRegion,
  setSelectedRegion,
  selectedBird,
  setSelectedBird,
  onStartGame,
  playersInGame,
  globalWinnings,
  connected,
  joining,
  privyReady,
  privyAuthenticated,
  cashoutError,
  mobilePortrait = false,
}) {
  const [showSkinModal, setShowSkinModal] = useState(false);
  const [walletBalanceUsd, setWalletBalanceUsd] = useState(null);
  const [walletBalanceSol, setWalletBalanceSol] = useState(null);
  const [isWalletConnected, setIsWalletConnected] = useState(false);

  const { wallets } = useWallets();
  const solanaRpc = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const [solPriceUsd, setSolPriceUsd] = useState(Number(import.meta.env.VITE_SOL_PRICE_USD || 0));
  const feeBufferUsd = Number(import.meta.env.VITE_ENTRY_FEE_BUFFER_USD || 0.2);
  const embeddedWallet = wallets?.find(
    (candidate) =>
      candidate?.walletClientType === 'privy' ||
      candidate?.isPrivyWallet ||
      candidate?.wallet?.isPrivyWallet ||
      candidate?.standardWallet?.name === 'Privy',
  ) ?? wallets?.[0];
  const walletAddress = embeddedWallet?.address;

  // Menu sfx (hover/click on any button)
  // - Lower volume
  // - Avoids spam from mouseover bubbling within the same button
  const menuAudioRef = useRef(null);
  const lastHoveredButtonRef = useRef(null);
  const playMenuSfx = () => {
    if (!menuAudioRef.current) {
      menuAudioRef.current = new Audio('/assets/sfx/menu_click.mp3');
      menuAudioRef.current.preload = 'auto';
      menuAudioRef.current.volume = 0.25;
    }
    try {
      menuAudioRef.current.currentTime = 0;
      menuAudioRef.current.play().catch(() => {});
    } catch {
      // Ignore autoplay restrictions until first user interaction
    }
  };


  const onMenuMouseOver = (e) => {
    const btn = e.target?.closest?.('button');
    if (!btn) return;
    if (lastHoveredButtonRef.current === btn) return;
    lastHoveredButtonRef.current = btn;
    playMenuSfx();
  };
  const onMenuMouseOut = (e) => {
    const btn = e.target?.closest?.('button');
    if (!btn) return;
    // reset hover tracking when leaving the button
    if (!e.relatedTarget || !btn.contains(e.relatedTarget)) {
      if (lastHoveredButtonRef.current === btn) lastHoveredButtonRef.current = null;
    }
  };
  const onMenuMouseDown = (e) => {
    if (e.target?.closest?.('button')) playMenuSfx();
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Format large numbers with commas
  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  useEffect(() => {
    if (solPriceUsd > 0) return;
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot');
        if (!res.ok) return;
        const data = await res.json();
        const price = Number(data?.data?.amount);
        if (!cancelled && Number.isFinite(price) && price > 0) {
          setSolPriceUsd(price);
        }
      } catch {
        // Ignore price fetch errors; SOL balance still shows.
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [solPriceUsd]);

  useEffect(() => {
    const connected = !!walletAddress;
    setIsWalletConnected(connected);

    if (!privyReady || !privyAuthenticated || !walletAddress || !solanaRpc) {
      setWalletBalanceSol(null);
      setWalletBalanceUsd(null);
      return;
    }

    let cancelled = false;
    const connection = new Connection(solanaRpc, 'confirmed');
    let backoffMs = 0;
    let timeoutId = null;

    const scheduleNext = (delay) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(loadBalance, delay);
    };

    const loadBalance = async () => {
      try {
        const lamports = await connection.getBalance(new PublicKey(walletAddress));
        if (cancelled) return;
        const sol = lamports / LAMPORTS_PER_SOL;
        setWalletBalanceSol(sol);
        if (solPriceUsd > 0) {
          setWalletBalanceUsd(sol * solPriceUsd);
        } else {
          setWalletBalanceUsd(null);
        }
        backoffMs = 0;
        scheduleNext(30000);
      } catch (err) {
        if (cancelled) return;
        const message = err?.message || '';
        const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate limited');
        if (isRateLimit) {
          backoffMs = backoffMs ? Math.min(backoffMs * 2, 120000) : 30000;
          scheduleNext(backoffMs);
          return;
        }
        console.error('Failed to load wallet balance:', err);
        setWalletBalanceSol(null);
        setWalletBalanceUsd(null);
        scheduleNext(30000);
      }
    };

    loadBalance();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [privyReady, privyAuthenticated, walletAddress, solanaRpc, solPriceUsd]);

  const buyInSol = solPriceUsd > 0 ? (selectedBet / solPriceUsd) : null;
  const feeBufferSol = solPriceUsd > 0 ? (feeBufferUsd / solPriceUsd) : null;
  const requiredSol = buyInSol !== null && feeBufferSol !== null ? buyInSol + feeBufferSol : null;
  const hasFunds = !!walletBalanceSol && requiredSol !== null && walletBalanceSol >= requiredSol;
  const canPlay = !!connected && !!privyReady && !joining;
  const copyWalletAddress = async () => {
    if (!walletAddress) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(walletAddress);
        return;
      }
    } catch {
      // Fall back to legacy copy.
    }

    const textarea = document.createElement('textarea');
    textarea.value = walletAddress;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // Ignore copy failures.
    }
    document.body.removeChild(textarea);
  };

  const joinPanel = (
    <div className="card center-card">
      {/* Username Input */}
      <input
        type="text"
        className="username-input"
        placeholder="Set Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={20}
      />

      {/* Region Toggle */}
      <div className="region-toggle">
        <button
          className={`region-btn ${selectedRegion === 'us' ? 'active' : ''}`}
          onClick={() => setSelectedRegion('us')}
        >
          US
        </button>
        <button
          className={`region-btn ${selectedRegion === 'eu' ? 'active' : ''}`}
          onClick={() => setSelectedRegion('eu')}
        >
          EU
        </button>
      </div>

      {/* Bet Buttons */}
      <div className="bet-buttons">
        {BET_AMOUNTS.map((amount) => (
          <button
            key={amount}
            className={`bet-btn ${selectedBet === amount ? 'active' : ''}`}
            onClick={() => setSelectedBet(amount)}
          >
            ${amount}
          </button>
        ))}
      </div>

      {/* Play Button */}
      <button
        className="play-btn"
        onClick={onStartGame}
        title={!connected ? 'Connecting to server...' : !privyReady ? 'Auth loading...' : !privyAuthenticated ? 'Login required' : !hasFunds ? 'Insufficient balance for buy-in' : ''}
      >
        {joining ? 'JOINING...' : 'JOIN MATCH'}
      </button>

      {/* Browse Lobbies */}
      <button className="btn btn-secondary browse-btn">Browse Servers</button>

      {/* Stats */}
      <div className="menu-stats">
        <div className="stat">
          <span className="stat-value players">{playersInGame}</span>
          <span className="stat-label">PLAYERS IN GAME</span>
        </div>
        <div className="stat">
          <span className="stat-value winnings">${formatNumber(globalWinnings)}</span>
          <span className="stat-label">GLOBAL WINNINGS</span>
        </div>
      </div>
    </div>
  );

  const walletPanel = (
    <div className="card wallet-card">
      <div className="card-header">
        <div className="card-title">
          <span>WALLET</span>
        </div>
        <button className="copy-address-btn" onClick={copyWalletAddress}>
          Copy Address
        </button>
      </div>
      {cashoutError && (
        <div style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 8 }}>
          {cashoutError}
        </div>
      )}
      {cashoutError && (
        <div style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 8 }}>
          {cashoutError}
        </div>
      )}
      <div className="wallet-balance">
        <span className="balance-amount">
          {privyAuthenticated ? `$${walletBalanceUsd === null ? '--' : formatCurrency(walletBalanceUsd)}` : '$0.00'}
        </span>
        <span className="balance-sol">
          {privyAuthenticated ? (walletBalanceSol === null ? '0.0000' : walletBalanceSol.toFixed(4)) : '0.0000'} SOL
        </span>
      </div>
      <div className="wallet-buttons">
        <PrivyAddFundsButton className="btn btn-primary wallet-btn" />
        <button className="btn btn-outline wallet-btn">CASH OUT</button>
      </div>
    </div>
  );

  const liveCashoutsPanel = (
    <div className="card cashouts-card">
      <div className="card-header">
        <div className="card-title">
          <span>LIVE CASHOUTS</span>
        </div>
        <div className="live-badge">
          <span className="live-dot"></span>
          Live
        </div>
      </div>
      <div className="cashouts-list">
        {MOCK_CASHOUTS.map((entry, index) => (
          <div key={index} className="cashout-item">
            <span className="name">{entry.name}</span>
            <span className="action">cashed out</span>
            <span className="amount">${formatCurrency(entry.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const leaderboardPanel = (
    <div className="card leaderboard-card">
      <div className="card-header">
        <div className="card-title">
          <span>LEADERBOARD</span>
        </div>
        <div className="live-badge">
          <span className="live-dot"></span>
          Live
        </div>
      </div>
      <div className="leaderboard-list">
        {MOCK_LEADERBOARD.map((entry) => (
          <div key={entry.rank} className="leaderboard-item">
            <span className="rank">{entry.rank}.</span>
            <span className="name">{entry.name}</span>
            <span className="amount">${formatCurrency(entry.amount)}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-secondary full-width">View Full Leaderboard</button>
    </div>
  );

  const customizePanel = (
    <div className="card customize-card">
      <div className="card-header">
        <div className="card-title">
          <span>CUSTOMIZE</span>
        </div>
      </div>
      <div className="bird-preview">
        <img
          src={`/assets/sprites/birds/${selectedBird}/fly_1.png`}
          alt={selectedBird}
          className="preview-bird pixel-art animate-float"
        />
      </div>
      <button 
        className="btn btn-secondary full-width"
        onClick={() => setShowSkinModal(true)}
      >
        Change Appearance
      </button>
    </div>
  );

  const manageReferralsPanel = (
    <div className="card manage-referrals-card">
      <button className="btn btn-primary full-width manage-referrals-btn">
        Manage Referrals
      </button>
    </div>
  );

  if (mobilePortrait) {
    return (
      <div
        className="main-menu mobile-portrait"
        onMouseOver={onMenuMouseOver}
        onMouseOut={onMenuMouseOut}
        onMouseDown={onMenuMouseDown}
      >
        <div className="mobile-stack">
          {joinPanel}
          {walletPanel}
          {liveCashoutsPanel}
          {leaderboardPanel}
          {customizePanel}
          {manageReferralsPanel}
        </div>

        {/* Skin Selection Modal */}
        {showSkinModal && (
          <div className="modal-overlay" onClick={() => setShowSkinModal(false)}>
            <div className="skin-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Choose Your Bird</h2>
                <button className="close-btn" onClick={() => setShowSkinModal(false)}>×</button>
              </div>
              <div className="skin-grid">
                {BIRD_TYPES.map((bird) => (
                  <button
                    key={bird}
                    className={`skin-option ${selectedBird === bird ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedBird(bird);
                      setShowSkinModal(false);
                    }}
                  >
                    <img
                      src={`/assets/sprites/birds/${bird}/fly_1.png`}
                      alt={bird}
                      className="pixel-art"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="main-menu"
      onMouseOver={onMenuMouseOver}
      onMouseOut={onMenuMouseOut}
      onMouseDown={onMenuMouseDown}
    >
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 50 }}>
        <PrivyLoginButton />
      </div>
      {/* Header */}
      <header className="menu-header">
        <h1 className="logo">
          <span className="logo-text">FLAPPY</span>
          <span className="logo-dot">.</span>
          <span className="logo-text">ONE</span>
        </h1>
        <p className="tagline">SKILL-BASED BETTING</p>
      </header>

      {/* Main Grid */}
      <div className="menu-grid">
        {/* Left Column */}
        <div className="menu-column left">
          {/* Wallet Card */}
          {walletPanel}

          {/* Leaderboard Card */}
          {leaderboardPanel}
        </div>

        {/* Center Column */}
        <div className="menu-column center">
          {joinPanel}
        </div>

        {/* Right Column */}
        <div className="menu-column right">
          {/* Customize Card */}
          {customizePanel}

          {/* Live Cashouts Card */}
          {liveCashoutsPanel}
        </div>
      </div>

      {/* Footer */}
      <div className="menu-footer">
        <button className="discord-btn">
          <span className="discord-icon">💬</span>
          Join Discord!
        </button>
        <div className="controls-hint">
          <span className="key">MOUSE</span> steer • 
          <span className="key">LMB/SPACE</span> shoot • 
          <span className="key">SHIFT</span> boost • 
          Hold <span className="key">F</span> to cashout
        </div>
      </div>

      {/* Total Pot Bar */}
      <div className="total-pot-bar">
        <span>Total Pot in Servers:</span>
        <span className="pot-amount">${formatNumber(globalWinnings)}</span>
      </div>

      {/* Skin Selection Modal */}
      {showSkinModal && (
        <div className="modal-overlay" onClick={() => setShowSkinModal(false)}>
          <div className="skin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Choose Your Bird</h2>
              <button className="close-btn" onClick={() => setShowSkinModal(false)}>×</button>
            </div>
            <div className="skin-grid">
              {BIRD_TYPES.map((bird) => (
                <button
                  key={bird}
                  className={`skin-option ${selectedBird === bird ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedBird(bird);
                    setShowSkinModal(false);
                  }}
                >
                  <img
                    src={`/assets/sprites/birds/${bird}/fly_1.png`}
                    alt={bird}
                    className="pixel-art"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MainMenu;
