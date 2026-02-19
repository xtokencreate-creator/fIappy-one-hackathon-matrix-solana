/**
 * Supabase Edge Function: authorize-cashout
 *
 * Signs a cashout authorization that the on-chain program verifies via the
 * Ed25519 native precompile. The client includes this signature in a
 * transaction alongside the program's `cashout` instruction.
 *
 * Flow:
 *   1. Game server calls this function with an API key + player info.
 *   2. Function reads the on-chain Session PDA to get current nonce + status.
 *   3. Function validates limits and rate-limits.
 *   4. Function signs the canonical 108-byte authorization message.
 *   5. Returns signature + parameters to the game server (→ client).
 *
 * Environment variables (set in Supabase dashboard):
 *   AUTHORITY_SECRET_KEY  — 64-byte ed25519 secret key, base64-encoded
 *   SOLANA_RPC_URL        — devnet RPC endpoint
 *   PROGRAM_ID            — deployed program ID (base58)
 *   API_SECRET            — shared secret for server-to-server auth
 *   SUPABASE_URL          — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import {
  decode as b64Decode,
  encode as b64Encode,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const DOMAIN_SEPARATOR = new TextEncoder().encode("FLAPPYONE_CASHOUT_V1"); // 20 bytes
const AUTH_EXPIRY_SECONDS = 120; // 2-minute window
const LAMPORTS_PER_SOL = 1_000_000_000;

// Tier caps: max payout per tier (generous for devnet; tighten for mainnet)
const TIER_CAPS: Record<number, number> = {
  1: 10 * LAMPORTS_PER_SOL, // max 10 SOL from a 1-SOL session
  5: 50 * LAMPORTS_PER_SOL,
  20: 200 * LAMPORTS_PER_SOL,
};

// On-chain Session account layout offsets (after 8-byte discriminator)
const SESSION_OFFSETS = {
  player: 8, // 32 bytes
  deposit_tier: 40, // 1 byte
  deposit_amount: 41, // 8 bytes (u64 LE)
  status: 49, // 1 byte
  max_claimable: 50, // 8 bytes
  started_at: 58, // 8 bytes
  nonce: 66, // 8 bytes (u64 LE)
  last_auth_hash: 74, // 32 bytes
  auth_expiry: 106, // 8 bytes
  bump: 114, // 1 byte
} as const;

const STATUS_ACTIVE = 1;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Base58 alphabet used by Solana. */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const c of s) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 char: ${c}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's → leading 0x00 bytes
  for (const c of s) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (const b of bytes) {
    if (b !== 0) break;
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/** Derive a PDA (no private key). Returns [address, bump]. */
function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array
): [Uint8Array, number] {
  // Try bumps 255 → 0 until we find an off-curve point.
  // In production use @solana/web3.js; this is a minimal devnet implementation.
  // For the edge function we read the bump from the on-chain account instead.
  throw new Error(
    "PDA derivation not needed here — session address is passed by caller or derived client-side"
  );
}

/** Read a little-endian u64 from a buffer at the given offset. */
function readU64LE(buf: Uint8Array, offset: number): bigint {
  const view = new DataView(buf.buffer, buf.byteOffset);
  return view.getBigUint64(offset, true);
}

/** Read a u8 from a buffer. */
function readU8(buf: Uint8Array, offset: number): number {
  return buf[offset];
}

/** Write a u64 into a Uint8Array in little-endian. */
function u64ToLE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

/** Write an i64 into a Uint8Array in little-endian. */
function i64ToLE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigInt64(0, value, true);
  return buf;
}

/**
 * Build the canonical 108-byte cashout authorization message.
 *
 * Layout:
 *   [ 0..20)  "FLAPPYONE_CASHOUT_V1"
 *   [20..52)  player pubkey          (32 bytes)
 *   [52..60)  max_claimable          (u64 LE)
 *   [60..68)  nonce                  (u64 LE)
 *   [68..76)  expiry                 (i64 LE)
 *   [76..108) program_id             (32 bytes)
 */
function buildCashoutMessage(
  playerPubkey: Uint8Array,
  maxClaimable: bigint,
  nonce: bigint,
  expiry: bigint,
  programId: Uint8Array
): Uint8Array {
  const msg = new Uint8Array(108);
  msg.set(DOMAIN_SEPARATOR, 0); // 20
  msg.set(playerPubkey, 20); // 32
  msg.set(u64ToLE(maxClaimable), 52); // 8
  msg.set(u64ToLE(nonce), 60); // 8
  msg.set(i64ToLE(expiry), 68); // 8
  msg.set(programId, 76); // 32
  return msg;
}

/** Fetch a Solana account's data via JSON-RPC. */
async function getAccountInfo(
  rpcUrl: string,
  address: string
): Promise<Uint8Array | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64" }],
    }),
  });
  const json = await res.json();
  if (!json.result?.value?.data?.[0]) return null;
  return new Uint8Array(
    atob(json.result.value.data[0])
      .split("")
      .map((c: string) => c.charCodeAt(0))
  );
}

// ── Main Handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  try {
    // ── Auth: server-to-server API key ──
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("API_SECRET");
    if (!apiKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    // ── Parse request body ──
    const body = await req.json();
    const {
      player_pubkey, // base58
      max_claimable_lamports, // number (server computed)
      session_pda, // base58 (optional — can derive)
    } = body;

    if (!player_pubkey || max_claimable_lamports == null) {
      return new Response(
        JSON.stringify({ error: "Missing player_pubkey or max_claimable_lamports" }),
        { status: 400 }
      );
    }

    // ── Load env ──
    const authoritySecretB64 = Deno.env.get("AUTHORITY_SECRET_KEY");
    const rpcUrl = Deno.env.get("SOLANA_RPC_URL") || "https://api.devnet.solana.com";
    const programIdB58 = Deno.env.get("PROGRAM_ID");

    if (!authoritySecretB64 || !programIdB58) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured" }),
        { status: 500 }
      );
    }

    const authoritySecret = b64Decode(authoritySecretB64);
    const authorityKeypair = nacl.sign.keyPair.fromSecretKey(authoritySecret);
    const programIdBytes = base58Decode(programIdB58);
    const playerPubkeyBytes = base58Decode(player_pubkey);

    // ── Read on-chain Session PDA ──
    // If session_pda not provided, the game server should pass it.
    // It can be derived client-side: PublicKey.findProgramAddressSync(
    //   [Buffer.from("session"), playerPubkey.toBuffer()], programId)
    if (!session_pda) {
      return new Response(
        JSON.stringify({ error: "session_pda is required" }),
        { status: 400 }
      );
    }

    const accountData = await getAccountInfo(rpcUrl, session_pda);
    if (!accountData) {
      return new Response(
        JSON.stringify({ error: "Session PDA not found on-chain" }),
        { status: 404 }
      );
    }

    // ── Parse session fields ──
    const onChainStatus = readU8(accountData, SESSION_OFFSETS.status);
    if (onChainStatus !== STATUS_ACTIVE) {
      return new Response(
        JSON.stringify({ error: "Session is not active" }),
        { status: 409 }
      );
    }

    const onChainNonce = readU64LE(accountData, SESSION_OFFSETS.nonce);
    const onChainTier = readU8(accountData, SESSION_OFFSETS.deposit_tier);

    // ── Validate max_claimable ──
    const maxClaimable = BigInt(max_claimable_lamports);

    // GUARD: must be positive
    if (maxClaimable <= 0n) {
      return new Response(
        JSON.stringify({ error: "max_claimable must be > 0" }),
        { status: 400 }
      );
    }

    // GUARD: tier-based cap
    const tierCap = BigInt(TIER_CAPS[onChainTier] || TIER_CAPS[1]);
    if (maxClaimable > tierCap) {
      return new Response(
        JSON.stringify({
          error: `max_claimable exceeds tier ${onChainTier} cap of ${tierCap} lamports`,
        }),
        { status: 400 }
      );
    }

    // ── Rate limiting via Supabase ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for recent authorizations (max 1 per 10 seconds per player)
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    const { data: recentAuths } = await supabase
      .from("cashout_authorizations")
      .select("id")
      .eq("player_pubkey", player_pubkey)
      .gte("created_at", tenSecondsAgo)
      .limit(1);

    if (recentAuths && recentAuths.length > 0) {
      return new Response(
        JSON.stringify({ error: "Rate limited — try again in a few seconds" }),
        { status: 429 }
      );
    }

    // ── Build authorization ──
    const nonce = onChainNonce;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + AUTH_EXPIRY_SECONDS);

    const message = buildCashoutMessage(
      playerPubkeyBytes,
      maxClaimable,
      nonce,
      expiry,
      programIdBytes
    );

    // ── Sign with authority key ──
    const signature = nacl.sign.detached(message, authorityKeypair.secretKey);

    // ── Store authorization record ──
    const { error: insertError } = await supabase
      .from("cashout_authorizations")
      .insert({
        player_pubkey,
        nonce: nonce.toString(),
        max_claimable: maxClaimable.toString(),
        expiry: expiry.toString(),
        signature: b64Encode(signature),
        status: "issued",
      });

    if (insertError) {
      // Unique constraint violation = duplicate nonce = replay attempt
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "Authorization already issued for this nonce" }),
          { status: 409 }
        );
      }
      console.error("DB insert error:", insertError);
      // Non-fatal: the auth is still valid, client can proceed
    }

    // ── Return authorization to caller ──
    return new Response(
      JSON.stringify({
        max_claimable: maxClaimable.toString(),
        nonce: nonce.toString(),
        expiry: expiry.toString(),
        signature: b64Encode(signature),
        message: b64Encode(message),
        authority_pubkey: base58Encode(authorityKeypair.publicKey),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("authorize-cashout error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
});
