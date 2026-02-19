import React, { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import './CashOutModal.css';

const usdFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toUsd2(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 100) / 100;
}

function isValidSolanaAddress(value) {
  try {
    const text = String(value || '').trim();
    if (!text) return false;
    // PublicKey constructor validates base58 and length.
    new PublicKey(text);
    return true;
  } catch {
    return false;
  }
}

export default function CashOutModal({
  open,
  onClose,
  onRefresh,
  onSubmit,
  balance,
  balanceError,
  walletConnected,
  loadingBalance,
  submitting,
}) {
  const [amountInput, setAmountInput] = useState('');
  const [destination, setDestination] = useState('');
  const [localError, setLocalError] = useState('');

  const usdBalance = Number(balance?.usdBalance || 0);
  const solBalance = Number(balance?.solBalance || 0);
  const maxWithdrawableUsd = Number(balance?.maxWithdrawableUsd || 0);
  const reservedUsd = Number(balance?.reservedUsd || 0.21);

  const amountUsd = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) ? n : 0;
  }, [amountInput]);

  const validDestination = useMemo(() => isValidSolanaAddress(destination), [destination]);
  const insufficient = maxWithdrawableUsd <= 0;
  const hasBalanceError = !!balanceError;
  const amountTooHigh = amountUsd > maxWithdrawableUsd + 1e-9;
  const amountTooLow = amountUsd <= 0;

  const canSubmit = !loadingBalance
    && !submitting
    && !hasBalanceError
    && !!walletConnected
    && !insufficient
    && validDestination
    && !amountTooLow
    && !amountTooHigh;

  const usagePct = maxWithdrawableUsd > 0
    ? Math.max(0, Math.min(100, (Math.max(0, amountUsd) / maxWithdrawableUsd) * 100))
    : 0;

  useEffect(() => {
    if (!open) return;
    setLocalError('');
    setAmountInput('');
  }, [open, balance?.walletPubkey]);

  if (!open) return null;

  const applyPercent = (pct) => {
    const next = toUsd2(maxWithdrawableUsd * pct);
    setAmountInput(next > 0 ? String(next.toFixed(2)) : '');
  };

  const applyMax = () => {
    const next = toUsd2(maxWithdrawableUsd);
    setAmountInput(next > 0 ? String(next.toFixed(2)) : '');
  };

  const handleSubmit = async () => {
    setLocalError('');
    if (!canSubmit) return;
    try {
      await onSubmit({
        amountUsd: toUsd2(amountUsd),
        destination: destination.trim(),
      });
    } catch (err) {
      setLocalError(err?.message || 'Cashout failed');
    }
  };

  return (
    <div className="cashout-modal__backdrop" role="presentation" onClick={onClose}>
      <div className="cashout-modal" role="dialog" aria-modal="true" aria-label="Cash Out" onClick={(e) => e.stopPropagation()}>
        <div className="cashout-modal__header">
          <h2>Cash Out</h2>
          <button type="button" className="cashout-modal__close social-close" onClick={onClose} aria-label="Close cash out modal">x</button>
        </div>

        <div className="cashout-modal__balanceRow">
          <div>
            <div className="cashout-modal__label">Available Balance</div>
            <div className="cashout-modal__usd">${usdFormatter.format(usdBalance)}</div>
            <div className="cashout-modal__sol">{Number.isFinite(solBalance) ? solBalance.toFixed(6) : '0.000000'} SOL</div>
          </div>
          <button
            type="button"
            className="cashout-modal__btn social-tab"
            onClick={onRefresh}
            disabled={loadingBalance || submitting}
          >
            {loadingBalance ? 'Refreshing...' : 'Refresh Balance'}
          </button>
        </div>

        {(insufficient || localError || hasBalanceError) && (
          <div className="cashout-modal__warning cashout-toast__button cashout-toast__button--red" role="alert">
            <span className="cashout-toast__icon" aria-hidden="true">i</span>
            <span className="cashout-toast__text">
              {localError || balanceError || 'Insufficient balance for cashout. Minimum $0.20 + $0.01 required.'}
            </span>
          </div>
        )}

        <div className="cashout-modal__field">
          <label htmlFor="cashout-amount">Amount (USD)</label>
          <div className="cashout-modal__amountRow">
            <input
              id="cashout-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={submitting}
            />
            <button type="button" className="cashout-modal__max social-tab" onClick={applyMax} disabled={insufficient || submitting || hasBalanceError || !walletConnected}>MAX</button>
          </div>
          <div className="cashout-modal__chips">
            <button type="button" className="social-tab" onClick={() => applyPercent(0.25)} disabled={insufficient || submitting || hasBalanceError || !walletConnected}>25%</button>
            <button type="button" className="social-tab" onClick={() => applyPercent(0.5)} disabled={insufficient || submitting || hasBalanceError || !walletConnected}>50%</button>
            <button type="button" className="social-tab" onClick={() => applyPercent(0.75)} disabled={insufficient || submitting || hasBalanceError || !walletConnected}>75%</button>
            <button type="button" className="social-tab" onClick={applyMax} disabled={insufficient || submitting || hasBalanceError || !walletConnected}>MAX</button>
          </div>
          <div className="cashout-modal__caption">{usagePct.toFixed(0)}% of withdrawable balance</div>
          <div className="cashout-modal__caption">Reserved: ${reservedUsd.toFixed(2)} (fees/rent)</div>
        </div>

        <div className="cashout-modal__field">
          <label htmlFor="cashout-destination">Destination Wallet</label>
          <input
            id="cashout-destination"
            type="text"
            placeholder="Enter Solana wallet address..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={submitting}
          />
          {!!destination && !validDestination && (
            <div className="cashout-modal__errorText">Enter a valid Solana base58 address.</div>
          )}
          {amountTooHigh && (
            <div className="cashout-modal__errorText">
              Amount exceeds max withdrawable (${maxWithdrawableUsd.toFixed(2)}).
            </div>
          )}
        </div>

        <div className="cashout-modal__footer">
          <button
            type="button"
            className="cashout-modal__btn social-tab"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cashout-modal__btn social-tab active"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'Processing...' : 'Cash Out'}
          </button>
        </div>
      </div>
    </div>
  );
}
