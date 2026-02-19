import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CrateRevealOverlay.css';

const FALL_DURATION = 400;
const ANTICIPATION_DURATION = 250;
const EXPLOSION_DURATION = 500;
const REVEAL_DELAY = 300;
const VOUCHER_IMAGE = '/nft/voucher/image.png';

const AUDIO_FILES = {
  menuClick: '/audio/menu_click.mp3',
  caseUnbox: '/audio/case_unbox.mp3',
  unboxedCrate: '/audio/unboxed_crate.mp3',
  boxDrop: '/audio/box_drop.mp3',
};

function DustParticles({ active }) {
  if (!active) return null;
  return (
    <div className="dust-container">
      <div className="dust dust--1" />
      <div className="dust dust--2" />
      <div className="dust dust--3" />
      <div className="dust dust--4" />
      <div className="dust dust--5" />
      <div className="dust dust--6" />
    </div>
  );
}

function CountdownPopup({ count, visible }) {
  if (!visible) return null;
  return (
    <div className="countdown-overlay">
      <div className="countdown-popup">
        <p className="countdown-title">UNCRATING YOUR LOOT</p>
        <span className="countdown-number">{count}</span>
      </div>
    </div>
  );
}

function CrateVisual({ entranceState, animState, onClick, showDust }) {
  const isClickable = entranceState === 'landed' && animState === 'idle';
  const visualAnimState = animState === 'countdown' ? 'idle' : animState;

  return (
    <div className={`crate-stage crate-stage--${entranceState}`}>
      <div className="crate-wrapper">
        <div
          className={`crate crate--entrance-${entranceState} crate--${visualAnimState}`}
          onClick={isClickable ? onClick : undefined}
          role={isClickable ? 'button' : undefined}
          tabIndex={isClickable ? 0 : undefined}
          onKeyDown={isClickable ? (e) => e.key === 'Enter' && onClick() : undefined}
        >
          <div className="crate__base">
            <div className="crate__texture" />
            <div className="crate__band crate__band--top" />
            <div className="crate__band crate__band--bottom" />
            <div className="crate__plank crate__plank--1" />
            <div className="crate__plank crate__plank--2" />
            <div className="crate__plank crate__plank--3" />
            <div className="crate__stamp">
              <div className="crate__stamp-border">
                <span className="crate__stamp-text">FLAPPY ONE</span>
              </div>
            </div>
            <div className="crate__bolt crate__bolt--tl" />
            <div className="crate__bolt crate__bolt--tr" />
            <div className="crate__bolt crate__bolt--bl" />
            <div className="crate__bolt crate__bolt--br" />
            <div className="crate__bolt crate__bolt--tm" />
            <div className="crate__bolt crate__bolt--bm" />
          </div>
          <div className="crate__lid">
            <div className="crate__lid-plank" />
            <div className="crate__lid-plank" />
            <div className="crate__lid-plank" />
          </div>
          <div className="crate__panel crate__panel--front"><div className="crate__panel-grain" /></div>
          <div className="crate__panel crate__panel--left"><div className="crate__panel-grain" /></div>
          <div className="crate__panel crate__panel--right"><div className="crate__panel-grain" /></div>
          <div className="crate__panel crate__panel--back"><div className="crate__panel-grain" /></div>
          <div className="crate__flying-bolt crate__flying-bolt--1" />
          <div className="crate__flying-bolt crate__flying-bolt--2" />
          <div className="crate__flying-bolt crate__flying-bolt--3" />
          <div className="crate__flying-bolt crate__flying-bolt--4" />
        </div>
        <div className={`crate__shadow crate__shadow--${entranceState}`} />
        <DustParticles active={showDust} />
        {isClickable ? <p className="crate-prompt">Click to open</p> : null}
      </div>
    </div>
  );
}

function RewardVoucher({ visible }) {
  if (!visible) return null;
  return (
    <div className="reward reward--visible">
      <div className="reward__glow" />
      <div className="reward__rays" />
      <div className="reward__content">
        <div className="reward__icon">
          <img className="reward__sprite reward__sprite--voucher" src={VOUCHER_IMAGE} alt="Flappy.one $1 Play Voucher NFT" draggable={false} />
        </div>
        <p className="reward__name">Reward Unlocked</p>
        <div className="reward__credit">
          <span className="reward__credit-amount">$1 Free-Play Voucher</span>
          <span className="reward__credit-label">Issued for demo completion</span>
        </div>
      </div>
    </div>
  );
}

function shortenSignature(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= 10) return value;
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

export default function CrateRevealOverlay({ visible, onBackToMenu, mintInfo = null, mintFailed = false }) {
  const [entranceState, setEntranceState] = useState('falling');
  const [crateAnim, setCrateAnim] = useState('idle');
  const [showReward, setShowReward] = useState(false);
  const [showDust, setShowDust] = useState(false);
  const [screenShake, setScreenShake] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [showCountdown, setShowCountdown] = useState(false);
  const [readyForMenu, setReadyForMenu] = useState(false);
  const audioRef = useRef({});

  const playAudio = useCallback((key) => {
    if (!AUDIO_FILES[key]) return;
    if (!audioRef.current[key]) {
      const audio = new Audio(AUDIO_FILES[key]);
      audio.preload = 'auto';
      audioRef.current[key] = audio;
    }
    const audio = audioRef.current[key];
    try {
      audio.currentTime = 0;
    } catch {}
    void audio.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    setEntranceState('falling');
    setCrateAnim('idle');
    setShowReward(false);
    setShowDust(false);
    setShowCountdown(false);
    setCountdownValue(3);
    setReadyForMenu(false);
    playAudio('boxDrop');
    const fallTimer = setTimeout(() => {
      setEntranceState('landed');
      setScreenShake(true);
      setShowDust(true);
      setTimeout(() => setScreenShake(false), 150);
      setTimeout(() => setShowDust(false), 800);
    }, FALL_DURATION);
    return () => clearTimeout(fallTimer);
  }, [visible, playAudio]);

  useEffect(() => {
    return () => {
      Object.values(audioRef.current).forEach((audio) => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
      });
    };
  }, []);

  const handleCrateClick = useCallback(() => {
    if (entranceState !== 'landed' || crateAnim !== 'idle') return;
    playAudio('menuClick');
    playAudio('caseUnbox');
    setCrateAnim('countdown');
    setShowCountdown(true);
    setCountdownValue(3);
    let count = 3;
    const interval = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
      } else {
        clearInterval(interval);
        setShowCountdown(false);
        setCrateAnim('anticipation');
        setTimeout(() => {
          setCrateAnim('exploding');
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 100);
          playAudio('unboxedCrate');
        }, ANTICIPATION_DURATION);
        setTimeout(() => {
          setCrateAnim('opened');
        }, ANTICIPATION_DURATION + EXPLOSION_DURATION);
        setTimeout(() => {
          setShowReward(true);
          setTimeout(() => setReadyForMenu(true), 120);
        }, ANTICIPATION_DURATION + EXPLOSION_DURATION + REVEAL_DELAY);
      }
    }, 1000);
  }, [entranceState, crateAnim, playAudio]);

  const rootClass = useMemo(
    () => `reveal-backdrop ${screenShake ? 'reveal-backdrop--shake' : ''}`,
    [screenShake]
  );

  if (!visible) return null;

  return (
    <div className={rootClass}>
      <div className="reveal-container">
        <CountdownPopup count={countdownValue} visible={showCountdown} />
        {!readyForMenu ? (
          <div className="reveal-stage">
            <CrateVisual entranceState={entranceState} animState={crateAnim} onClick={handleCrateClick} showDust={showDust} />
            <RewardVoucher visible={showReward} />
          </div>
        ) : (
          <div className="reveal-content">
            <div className="reveal-opened-crate">
              <RewardVoucher visible />
            </div>
            <div className="reveal-mint-status" aria-live="polite">
              {mintFailed ? (
                <span className="reveal-mint-status__error">Voucher mint failed, try again from menu</span>
              ) : mintInfo?.txSignature ? (
                <span className="reveal-mint-status__ok">
                  Minted on devnet {shortenSignature(mintInfo.txSignature)}
                </span>
              ) : (
                <span className="reveal-mint-status__pending">Minting voucher on devnet...</span>
              )}
            </div>
            <button className="reveal-btn reveal-btn--gold" onClick={onBackToMenu} type="button">
              Back to Main Menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
