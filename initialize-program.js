/**
 * initialize-program.js — One-time on-chain initialization.
 *
 * Calls the `initialize` instruction to create the VaultConfig PDA
 * and record the treasury + authority pubkeys.
 *
 * Usage (from WSL):
 *   node initialize-program.js
 *
 * Reads from environment or defaults:
 *   FLAPPY_PROGRAM_ID   — deployed program ID
 *   TREASURY_PUBKEY      — wallet that receives 10% fees
 *   AUTHORITY_KEYPAIR    — path to authority keypair JSON
 *   DEPLOYER_KEYPAIR     — path to deployer keypair JSON (pays for tx)
 */

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Config ─────────────────────────────────────────────────────────────────

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Read program ID from Anchor.toml if not in env
function getProgramId() {
  if (process.env.FLAPPY_PROGRAM_ID) {
    return new PublicKey(process.env.FLAPPY_PROGRAM_ID);
  }
  // Try parsing Anchor.toml
  const anchorToml = fs.readFileSync(
    path.join(__dirname, "Anchor.toml"),
    "utf-8"
  );
  const match = anchorToml.match(/flappy_one\s*=\s*"([^"]+)"/);
  if (match) return new PublicKey(match[1]);
  throw new Error("Set FLAPPY_PROGRAM_ID or ensure Anchor.toml has the ID");
}

const PROGRAM_ID = getProgramId();

const TREASURY_PUBKEY = new PublicKey(
  process.env.TREASURY_PUBKEY ||
    "BdjgaSf75uTDSD1CdR9vDmKw6KA9xmAPdqRiGeKp8Y3S"
);

// ── Load keypairs ──────────────────────────────────────────────────────────

function loadKeypair(envVar, defaultPath) {
  const kpPath = process.env[envVar] || defaultPath;
  const raw = JSON.parse(fs.readFileSync(kpPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const deployerKeypair = loadKeypair(
  "DEPLOYER_KEYPAIR",
  path.join(
    process.env.HOME || process.env.USERPROFILE,
    ".config/solana/id.json"
  )
);

const authorityKeypair = loadKeypair(
  "AUTHORITY_KEYPAIR",
  path.join(__dirname, "authority-keypair.json")
);

// ── PDA derivation ─────────────────────────────────────────────────────────

const [configPDA, configBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  PROGRAM_ID
);

const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  PROGRAM_ID
);

// ── Build instruction ──────────────────────────────────────────────────────

function anchorDiscriminator(name) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Check if already initialized
  const configAccount = await connection.getAccountInfo(configPDA);
  if (configAccount && configAccount.data.length > 0) {
    console.log("Program already initialized!");
    console.log("  Config PDA:", configPDA.toBase58());
    console.log("  Vault PDA: ", vaultPDA.toBase58());
    process.exit(0);
  }

  console.log("=== Initializing Flappy.one Program ===");
  console.log("  Program ID:  ", PROGRAM_ID.toBase58());
  console.log("  Treasury:    ", TREASURY_PUBKEY.toBase58());
  console.log("  Authority:   ", authorityKeypair.publicKey.toBase58());
  console.log("  Config PDA:  ", configPDA.toBase58());
  console.log("  Vault PDA:   ", vaultPDA.toBase58());
  console.log("  Deployer:    ", deployerKeypair.publicKey.toBase58());
  console.log("");

  // Data: [8-byte discriminator][32-byte treasury pubkey]
  const disc = anchorDiscriminator("initialize");
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  TREASURY_PUBKEY.toBuffer().copy(data, 8);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      // payer (deployer) — signer, writable
      {
        pubkey: deployerKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // authority — not a signer here, just reading pubkey
      {
        pubkey: authorityKeypair.publicKey,
        isSigner: false,
        isWritable: false,
      },
      // config PDA — writable (being created)
      { pubkey: configPDA, isSigner: false, isWritable: true },
      // vault PDA — writable (Anchor records bump)
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      // system program
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [
    deployerKeypair,
  ]);

  console.log("Initialized successfully!");
  console.log("  Transaction:", sig);
  console.log("");
  console.log("=== Verify ===");
  console.log(`  solana account ${configPDA.toBase58()}`);
  console.log(`  solana account ${vaultPDA.toBase58()}`);
  console.log("");

  // Print the env vars to copy
  const authoritySecretB64 = Buffer.from(authorityKeypair.secretKey).toString(
    "base64"
  );
  console.log("=== Add these to your .env files ===");
  console.log(`FLAPPY_PROGRAM_ID=${PROGRAM_ID.toBase58()}`);
  console.log(`AUTHORITY_SECRET_KEY=${authoritySecretB64}`);
  console.log(`VITE_FLAPPY_PROGRAM_ID=${PROGRAM_ID.toBase58()}`);
}

main().catch((err) => {
  console.error("Initialization failed:", err);
  process.exit(1);
});
