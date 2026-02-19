/**
 * solana-helpers.js — Server-side helpers for the game server (Node.js).
 *
 * Provides:
 *   - forceCloseOnDeath(): Submit on-chain tx when a player dies.
 *   - requestCashoutAuth(): Call the Supabase Edge Function to get a
 *     signed cashout authorization.
 *
 * These are called from server.js in response to game events.
 */

const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const crypto = require("crypto");

// ── Configuration ──────────────────────────────────────────────────────────

// Replace after `anchor build` / `anchor keys list`
const PROGRAM_ID = new PublicKey(
  process.env.FLAPPY_PROGRAM_ID ||
    "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

const SUPABASE_FUNCTIONS_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1`
  : null;

const API_SECRET = process.env.API_SECRET || "";

// Authority keypair (game server key — same key stored in VaultConfig.authority)
// Load from env: base64-encoded 64-byte ed25519 secret key
let authorityKeypair = null;
if (process.env.AUTHORITY_SECRET_KEY) {
  const secretBytes = Buffer.from(process.env.AUTHORITY_SECRET_KEY, "base64");
  authorityKeypair = Keypair.fromSecretKey(secretBytes);
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

function getSessionPDA(playerPubkey) {
  const pk =
    playerPubkey instanceof PublicKey
      ? playerPubkey
      : new PublicKey(playerPubkey);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), pk.toBuffer()],
    PROGRAM_ID
  );
}

function getConfigPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
}

// ── Discriminator ──────────────────────────────────────────────────────────

function anchorDiscriminator(name) {
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ── force_close_on_death ───────────────────────────────────────────────────

/**
 * Submit an on-chain transaction to force-close a player's session.
 * Called by the game server when a player dies.
 *
 * @param {string} playerPubkey — Player's wallet address (base58).
 * @returns {string} Transaction signature.
 */
async function forceCloseOnDeath(playerPubkey) {
  if (!authorityKeypair) {
    throw new Error("AUTHORITY_SECRET_KEY not configured");
  }

  const connection = new Connection(SOLANA_RPC, "confirmed");
  const [sessionPDA] = getSessionPDA(playerPubkey);
  const [configPDA] = getConfigPDA();

  // Build instruction data: just the 8-byte discriminator (no args)
  const data = anchorDiscriminator("force_close_on_death");

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      {
        pubkey: authorityKeypair.publicKey,
        isSigner: true,
        isWritable: false,
      },
      { pubkey: sessionPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [
    authorityKeypair,
  ]);

  console.log(
    `[solana] force_close_on_death for ${playerPubkey}: ${sig}`
  );
  return sig;
}

// ── requestCashoutAuth ─────────────────────────────────────────────────────

/**
 * Call the Supabase Edge Function to get a signed cashout authorization.
 *
 * @param {string} playerPubkey — Player's wallet address (base58).
 * @param {number} maxClaimableLamports — Server-computed max earnings.
 * @returns {object} { max_claimable, nonce, expiry, signature, message, authority_pubkey }
 */
async function requestCashoutAuth(playerPubkey, maxClaimableLamports) {
  if (!SUPABASE_FUNCTIONS_URL) {
    throw new Error("SUPABASE_URL not configured");
  }

  const [sessionPDA] = getSessionPDA(playerPubkey);

  const res = await fetch(
    `${SUPABASE_FUNCTIONS_URL}/authorize-cashout`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_SECRET,
      },
      body: JSON.stringify({
        player_pubkey: playerPubkey,
        max_claimable_lamports: maxClaimableLamports,
        session_pda: sessionPDA.toBase58(),
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      `authorize-cashout failed (${res.status}): ${err.error || JSON.stringify(err)}`
    );
  }

  return res.json();
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  PROGRAM_ID,
  getSessionPDA,
  getConfigPDA,
  forceCloseOnDeath,
  requestCashoutAuth,
};
