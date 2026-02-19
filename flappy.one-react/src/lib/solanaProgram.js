/**
 * solanaProgram.js — Client-side helpers for interacting with the Flappy.one
 * on-chain program (deposit, cashout).
 *
 * Integrates with the existing Privy embedded wallet via @solana/web3.js v1.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Ed25519Program,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ── Configuration ──────────────────────────────────────────────────────────

// Replace after `anchor keys list` / `anchor build`
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_FLAPPY_PROGRAM_ID ||
    "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

const TREASURY_PUBKEY = new PublicKey(
  import.meta.env.VITE_TREASURY_WALLET_PUBLIC_KEY ||
    "BdjgaSf75uTDSD1CdR9vDmKw6KA9xmAPdqRiGeKp8Y3S"
);

const SOLANA_RPC =
  import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Anchor discriminators (first 8 bytes of SHA-256("global:<instruction_name>"))
// Pre-computed for each instruction.
const DISCRIMINATORS = {
  deposit: new Uint8Array([
    0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6,
  ]),
  cashout: new Uint8Array([
    0x14, 0xd8, 0x12, 0xf9, 0xd7, 0x0b, 0xd6, 0x53,
  ]),
};

// ── PDA Derivation ─────────────────────────────────────────────────────────

/**
 * Derive the vault PDA (holds all deposited SOL).
 * Seeds: ["vault"]
 */
export function getVaultPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
}

/**
 * Derive the config PDA (stores treasury + authority + bumps).
 * Seeds: ["config"]
 */
export function getConfigPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
}

/**
 * Derive a player's session PDA.
 * Seeds: ["session", player_pubkey]
 */
export function getSessionPDA(playerPubkey) {
  const pk =
    playerPubkey instanceof PublicKey
      ? playerPubkey
      : new PublicKey(playerPubkey);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), pk.toBuffer()],
    PROGRAM_ID
  );
}

// ── Instruction Builders ───────────────────────────────────────────────────

/**
 * Build the Anchor `deposit(tier)` instruction.
 *
 * Accounts (in order, matching the Anchor IDL):
 *   0. player       [signer, writable]
 *   1. session      [writable]
 *   2. vault        [writable]
 *   3. config       []
 *   4. systemProgram []
 *
 * Data: [8-byte discriminator][1-byte tier]
 */
export function buildDepositInstruction(playerPubkey, tier) {
  const pk =
    playerPubkey instanceof PublicKey
      ? playerPubkey
      : new PublicKey(playerPubkey);
  const [sessionPDA] = getSessionPDA(pk);
  const [vaultPDA] = getVaultPDA();
  const [configPDA] = getConfigPDA();

  // Serialize instruction data: discriminator + tier (u8)
  const data = Buffer.alloc(9);
  data.set(DISCRIMINATORS.deposit, 0);
  data.writeUInt8(tier, 8);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pk, isSigner: true, isWritable: true },
      { pubkey: sessionPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the Anchor `cashout(amount, max_claimable, nonce, expiry)` instruction.
 *
 * Accounts (in order):
 *   0. player            [signer, writable]
 *   1. session           [writable]
 *   2. vault             [writable]
 *   3. treasury          [writable]
 *   4. config            []
 *   5. instructions_sysvar []
 *   6. systemProgram     []
 *
 * Data: [8-byte discriminator][u64 amount][u64 max_claimable][u64 nonce][i64 expiry]
 */
export function buildCashoutInstruction(
  playerPubkey,
  amountLamports,
  maxClaimableLamports,
  nonce,
  expiry
) {
  const pk =
    playerPubkey instanceof PublicKey
      ? playerPubkey
      : new PublicKey(playerPubkey);
  const [sessionPDA] = getSessionPDA(pk);
  const [vaultPDA] = getVaultPDA();
  const [configPDA] = getConfigPDA();

  // Instructions sysvar
  const SYSVAR_INSTRUCTIONS =
    "Sysvar1nstructions1111111111111111111111111";
  const instructionsSysvar = new PublicKey(SYSVAR_INSTRUCTIONS);

  // Serialize: discriminator + amount(u64) + max_claimable(u64) + nonce(u64) + expiry(i64)
  const data = Buffer.alloc(8 + 8 + 8 + 8 + 8); // 40 bytes
  data.set(DISCRIMINATORS.cashout, 0);
  data.writeBigUInt64LE(BigInt(amountLamports), 8);
  data.writeBigUInt64LE(BigInt(maxClaimableLamports), 16);
  data.writeBigUInt64LE(BigInt(nonce), 24);
  data.writeBigInt64LE(BigInt(expiry), 32);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pk, isSigner: true, isWritable: true },
      { pubkey: sessionPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: TREASURY_PUBKEY, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: instructionsSysvar, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Transaction Builders ───────────────────────────────────────────────────

/**
 * Build a complete deposit transaction.
 *
 * @param {string} playerPubkey — Player wallet address (base58).
 * @param {number} tier — 1, 5, or 20.
 * @returns {Transaction}
 */
export function buildDepositTransaction(playerPubkey, tier) {
  const tx = new Transaction();
  tx.add(buildDepositInstruction(playerPubkey, tier));
  return tx;
}

/**
 * Build a complete cashout transaction with Ed25519 verification.
 *
 * The transaction contains two instructions:
 *   [0] Ed25519Program signature verification (authority's sig over the message)
 *   [1] Our program's `cashout` instruction
 *
 * @param {string} playerPubkey — Player wallet address (base58).
 * @param {number} amountLamports — Amount to cash out (≤ maxClaimable).
 * @param {object} auth — Authorization from the server:
 *   { max_claimable, nonce, expiry, signature (base64), message (base64), authority_pubkey }
 * @returns {Transaction}
 */
export function buildCashoutTransaction(playerPubkey, amountLamports, auth) {
  const tx = new Transaction();

  // Decode server authorization
  const signatureBytes = Uint8Array.from(atob(auth.signature), (c) =>
    c.charCodeAt(0)
  );
  const messageBytes = Uint8Array.from(atob(auth.message), (c) =>
    c.charCodeAt(0)
  );
  const authorityPubkeyBytes = new PublicKey(
    auth.authority_pubkey
  ).toBytes();

  // Instruction 0: Ed25519 signature verification
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: authorityPubkeyBytes,
    message: messageBytes,
    signature: signatureBytes,
  });
  tx.add(ed25519Ix);

  // Instruction 1: Our cashout instruction
  const cashoutIx = buildCashoutInstruction(
    playerPubkey,
    amountLamports,
    auth.max_claimable,
    auth.nonce,
    auth.expiry
  );
  tx.add(cashoutIx);

  return tx;
}

// ── Session Reader ─────────────────────────────────────────────────────────

/**
 * Read a player's on-chain session state.
 *
 * @param {Connection} connection — Solana RPC connection.
 * @param {string} playerPubkey — Player wallet address (base58).
 * @returns {object|null} Parsed session or null if not found.
 */
export async function readSessionAccount(connection, playerPubkey) {
  const [sessionPDA] = getSessionPDA(playerPubkey);
  const info = await connection.getAccountInfo(sessionPDA);
  if (!info || !info.data || info.data.length < 115) return null;

  const data = info.data;
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );

  return {
    address: sessionPDA.toBase58(),
    player: new PublicKey(data.slice(8, 40)).toBase58(),
    depositTier: data[40],
    depositAmount: Number(view.getBigUint64(41, true)),
    status: data[49], // 0=Inactive, 1=Active, 2=Closed
    maxClaimable: Number(view.getBigUint64(50, true)),
    startedAt: Number(view.getBigInt64(58, true)),
    nonce: Number(view.getBigUint64(66, true)),
    authExpiry: Number(view.getBigInt64(106, true)),
    bump: data[114],
  };
}

// ── High-Level Flow Helpers ────────────────────────────────────────────────

/**
 * Execute the deposit flow:
 *   1. Build deposit transaction
 *   2. Sign with Privy embedded wallet
 *   3. Send and confirm
 *
 * @param {object} wallet — Privy wallet object (from useWallets()).
 * @param {number} tier — 1, 5, or 20.
 * @returns {string} Transaction signature.
 */
export async function executeDeposit(wallet, tier) {
  if (![1, 5, 20].includes(tier)) throw new Error("Invalid tier");

  const connection = new Connection(SOLANA_RPC, "confirmed");
  const playerPubkey = wallet.address;
  const tx = buildDepositTransaction(playerPubkey, tier);

  tx.feePayer = new PublicKey(playerPubkey);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // Serialize → sign via Privy → deserialize
  const serialized = tx
    .serialize({ requireAllSignatures: false })
    .toString("base64");

  const signed = await wallet.signTransaction({
    chain: import.meta.env.VITE_SOLANA_CAIP2 || "solana:devnet",
    transaction: serialized,
    address: wallet.address,
  });

  const signedTx = Transaction.from(Buffer.from(signed, "base64"));
  const sig = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Execute the cashout flow:
 *   1. Request authorization from server (via game server WebSocket or API)
 *   2. Build cashout transaction with Ed25519 verification
 *   3. Sign with Privy embedded wallet
 *   4. Send and confirm
 *
 * @param {object} wallet — Privy wallet object.
 * @param {number} amountLamports — Amount to cash out.
 * @param {object} auth — Server authorization response.
 * @returns {string} Transaction signature.
 */
export async function executeCashout(wallet, amountLamports, auth) {
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const playerPubkey = wallet.address;
  const tx = buildCashoutTransaction(playerPubkey, amountLamports, auth);

  tx.feePayer = new PublicKey(playerPubkey);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const serialized = tx
    .serialize({ requireAllSignatures: false })
    .toString("base64");

  const signed = await wallet.signTransaction({
    chain: import.meta.env.VITE_SOLANA_CAIP2 || "solana:devnet",
    transaction: serialized,
    address: wallet.address,
  });

  const signedTx = Transaction.from(Buffer.from(signed, "base64"));
  const sig = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

// ── Discriminator computation ──────────────────────────────────────────────

/**
 * Compute Anchor instruction discriminator.
 * SHA-256("global:<name>")[0..8]
 *
 * Usage: call once at build time, paste the result into DISCRIMINATORS above.
 *
 *   computeDiscriminator("deposit")  → Uint8Array(8)
 *   computeDiscriminator("cashout")  → Uint8Array(8)
 */
export async function computeDiscriminator(instructionName) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`global:${instructionName}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash).slice(0, 8);
}
