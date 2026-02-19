'use strict';

/**
 * ArciumClient — Node.js client for submitting pair risk scoring
 * computations to the Arcium MXE network via on-chain Solana transactions.
 *
 * Flow:
 *   1. Encrypt 5 pair features (u16, scaled 0-10000) with x25519 + RescueCipher
 *   2. Submit Solana TX calling the score_pair instruction
 *   3. Await MPC finalization (callback writes encrypted result on-chain)
 *   4. Decrypt the result using the session shared secret
 *
 * Requires: @coral-xyz/anchor, @solana/web3.js, @arcium-hq/client
 *
 * Environment:
 *   ARCIUM_PROGRAM_ID  — deployed program ID (from target/deploy)
 *   ARCIUM_KEYPAIR     — path to Solana keypair JSON for the payer
 *   SOLANA_RPC_URL     — Solana RPC endpoint (default: devnet)
 */

let anchor, web3, arciumClient;

// Lazy-load ESM dependencies (the server is CommonJS)
async function loadDeps() {
    if (anchor) return;
    anchor = await import('@coral-xyz/anchor');
    web3 = await import('@solana/web3.js');
    arciumClient = await import('@arcium-hq/client');
}

const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.ARCIUM_PROGRAM_ID || null;
const KEYPAIR_PATH = process.env.ARCIUM_KEYPAIR || null;
const IDL_PATH = process.env.ARCIUM_IDL_PATH || null;
const FINALIZE_TIMEOUT_MS = 60_000;

// ── State ───────────────────────────────────────────────────────────

let _initialized = false;
let _provider = null;
let _program = null;
let _payer = null;
let _mxePublicKey = null;
let _arciumEnv = null;
let _clusterAccount = null;

// ── Initialization ──────────────────────────────────────────────────

async function init() {
    if (_initialized) return true;
    if (!PROGRAM_ID || !KEYPAIR_PATH) {
        console.log('[arcium-client] Missing ARCIUM_PROGRAM_ID or ARCIUM_KEYPAIR, skipping init');
        return false;
    }

    try {
        await loadDeps();

        // Load keypair
        const kpData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
        _payer = web3.Keypair.fromSecretKey(new Uint8Array(kpData));

        // Set up Anchor provider
        const connection = new web3.Connection(SOLANA_RPC, 'confirmed');
        const wallet = new anchor.Wallet(_payer);
        _provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: 'confirmed',
        });

        // Load IDL
        let idl;
        if (IDL_PATH) {
            idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'));
        } else {
            // Try default path relative to arcium project
            const defaultIdlPath = path.resolve(
                __dirname, '..', '..', 'arcium_project', 'flappyone_risk',
                'target', 'idl', 'flappyone_risk.json'
            );
            if (fs.existsSync(defaultIdlPath)) {
                idl = JSON.parse(fs.readFileSync(defaultIdlPath, 'utf-8'));
            } else {
                console.error('[arcium-client] IDL not found at', defaultIdlPath);
                return false;
            }
        }

        const programId = new web3.PublicKey(PROGRAM_ID);
        _program = new anchor.Program(idl, programId, _provider);

        // Get Arcium environment
        _arciumEnv = arciumClient.getArciumEnv();
        _clusterAccount = arciumClient.getClusterAccAddress(_arciumEnv.arciumClusterOffset);

        // Get MXE public key for encryption
        _mxePublicKey = await arciumClient.getMXEPublicKey(_provider, programId);
        if (!_mxePublicKey) {
            console.error('[arcium-client] Could not fetch MXE public key');
            return false;
        }

        _initialized = true;
        console.log('[arcium-client] Initialized. Program:', PROGRAM_ID);
        console.log('[arcium-client] Payer:', _payer.publicKey.toBase58());
        return true;
    } catch (err) {
        console.error('[arcium-client] Init failed:', err.message);
        return false;
    }
}

// ── Scale float features to u16 0-10000 ─────────────────────────────

function scaleU16(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 10000);
}

// ── Submit pair scoring computation ─────────────────────────────────

/**
 * Encrypt pair features and submit on-chain for MPC scoring.
 *
 * @param {object} features - Pair features (floats 0-1)
 * @param {number} features.time_in_proximity
 * @param {number} features.non_aggression_score
 * @param {number} features.farm_loop_score
 * @param {number} features.mutual_damage_ratio
 * @param {number} features.repeated_encounter_count_normalized
 * @returns {Promise<{score: number, txSig: string} | null>} Decrypted score (0-1 float) or null on error
 */
async function submitPairScore(features) {
    if (!_initialized) {
        const ok = await init();
        if (!ok) return null;
    }

    try {
        // Generate ephemeral x25519 keypair for this computation
        const privateKey = arciumClient.x25519.utils.randomSecretKey();
        const publicKey = arciumClient.x25519.getPublicKey(privateKey);
        const sharedSecret = arciumClient.x25519.getSharedSecret(privateKey, _mxePublicKey);
        const cipher = new arciumClient.RescueCipher(sharedSecret);

        // Scale features to u16
        const plaintext = [
            BigInt(scaleU16(features.time_in_proximity)),
            BigInt(scaleU16(features.non_aggression_score)),
            BigInt(scaleU16(features.farm_loop_score)),
            BigInt(scaleU16(features.mutual_damage_ratio)),
            BigInt(scaleU16(features.repeated_encounter_count_normalized)),
        ];

        // Encrypt
        const nonce = randomBytes(16);
        const ciphertext = cipher.encrypt(plaintext, nonce);

        // Random computation offset
        const computationOffset = new anchor.BN(randomBytes(8), 'hex');

        // Submit TX
        const txSig = await _program.methods
            .scorePair(
                computationOffset,
                Array.from(ciphertext[0]),
                Array.from(ciphertext[1]),
                Array.from(ciphertext[2]),
                Array.from(ciphertext[3]),
                Array.from(ciphertext[4]),
                Array.from(publicKey),
                new anchor.BN(arciumClient.deserializeLE(nonce).toString()),
            )
            .accountsPartial({
                computationAccount: arciumClient.getComputationAccAddress(
                    _arciumEnv.arciumClusterOffset,
                    computationOffset,
                ),
                clusterAccount: _clusterAccount,
                mxeAccount: arciumClient.getMXEAccAddress(_program.programId),
                mempoolAccount: arciumClient.getMempoolAccAddress(
                    _arciumEnv.arciumClusterOffset,
                ),
                executingPool: arciumClient.getExecutingPoolAccAddress(
                    _arciumEnv.arciumClusterOffset,
                ),
                compDefAccount: arciumClient.getCompDefAccAddress(
                    _program.programId,
                    Buffer.from(
                        arciumClient.getCompDefAccOffset('score_pair'),
                    ).readUInt32LE(),
                ),
            })
            .rpc({ skipPreflight: true, commitment: 'confirmed' });

        console.log('[arcium-client] Submitted score_pair TX:', txSig);

        // Await finalization
        const finalizeSig = await arciumClient.awaitComputationFinalization(
            _provider,
            computationOffset,
            _program.programId,
            'confirmed',
        );

        console.log('[arcium-client] Finalized:', finalizeSig);

        // Listen for the RiskScoreEvent to get the encrypted result
        // For now, parse it from the finalization transaction logs
        const tx = await _provider.connection.getTransaction(finalizeSig, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && tx.meta.logMessages) {
            // The event data is in program logs; the Anchor event parser handles it
            const eventParser = new anchor.EventParser(
                _program.programId,
                new anchor.BorshCoder(_program.idl),
            );
            const events = [];
            eventParser.parseLogs(tx.meta.logMessages, (event) => {
                events.push(event);
            });

            const riskEvent = events.find(e => e.name === 'riskScoreEvent');
            if (riskEvent) {
                const decrypted = cipher.decrypt(
                    [riskEvent.data.encryptedScore],
                    riskEvent.data.nonce,
                )[0];
                const score = Number(decrypted) / 10000; // scale back to 0-1
                console.log(`[arcium-client] Decrypted risk score: ${score.toFixed(4)}`);
                return { score, txSig };
            }
        }

        console.warn('[arcium-client] Could not parse RiskScoreEvent from TX');
        return null;
    } catch (err) {
        console.error('[arcium-client] submitPairScore failed:', err.message);
        return null;
    }
}

/**
 * Check if the Arcium client is ready for use.
 */
function isReady() {
    return _initialized;
}

module.exports = { init, submitPairScore, isReady, scaleU16 };
