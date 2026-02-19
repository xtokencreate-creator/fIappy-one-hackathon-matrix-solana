use anchor_lang::prelude::*;
use anchor_lang::system_program;
use solana_program::ed25519_program;
use solana_program::hash;
use solana_program::sysvar::instructions as ix_sysvar;

// ============================================================================
// PROGRAM ID — Replace after `anchor keys list` or `anchor build`
// ============================================================================
declare_id!("8b4U8WX2SNJ1p53m2w6GcMjCooo7KTGdWZiFBmcZ4MwK");

// ============================================================================
// CONSTANTS
// ============================================================================

/// Domain separator prevents cross-protocol message reuse.
/// Fixed 20 bytes — included in every cashout authorization message.
const DOMAIN_SEPARATOR: &[u8; 20] = b"FLAPPYONE_CASHOUT_V1";

/// 10% platform fee = 1000 basis points.
const FEE_BPS: u64 = 1_000;
const BPS_DENOMINATOR: u64 = 10_000;

/// Allowed deposit tiers in lamports.
const TIER_1_LAMPORTS: u64 = 1_000_000_000; // 1 SOL
const TIER_5_LAMPORTS: u64 = 5_000_000_000; // 5 SOL
const TIER_20_LAMPORTS: u64 = 20_000_000_000; // 20 SOL

/// Session status values (u8 for safe zero-default on fresh accounts).
const STATUS_INACTIVE: u8 = 0;
const STATUS_ACTIVE: u8 = 1;
const STATUS_CLOSED: u8 = 2;

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod flappy_one {
    use super::*;

    // ────────────────────────────────────────────────────────────────────────
    // initialize — one-time setup by deployer
    // ────────────────────────────────────────────────────────────────────────

    /// Creates the global VaultConfig PDA and records the vault PDA bump.
    ///
    /// Must be called exactly once after deployment.
    ///
    /// # Arguments
    /// * `treasury` — Pubkey that receives 10 % fees on cashouts.
    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.treasury = treasury;
        config.authority = ctx.accounts.authority.key();
        config.vault_bump = ctx.bumps.vault;
        config.config_bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            treasury,
            authority: config.authority,
        });
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // deposit — player enters a game session
    // ────────────────────────────────────────────────────────────────────────

    /// Transfers SOL from player → PDA-controlled vault and activates a session.
    ///
    /// # Guards
    /// - `tier` must be 1, 5, or 20.
    /// - Session must NOT already be active (no double-deposit).
    /// - SOL goes to a PDA; no private key can move it.
    pub fn deposit(ctx: Context<Deposit>, tier: u8) -> Result<()> {
        // GUARD: tier ∈ {1, 5, 20}
        let deposit_lamports = match tier {
            1 => TIER_1_LAMPORTS,
            5 => TIER_5_LAMPORTS,
            20 => TIER_20_LAMPORTS,
            _ => return Err(FlappyError::InvalidTier.into()),
        };

        let session = &mut ctx.accounts.session;

        // GUARD: prevent double-deposit while a session is live.
        // On a brand-new account (init_if_needed just created it) player == default.
        // On a recycled account status must be Closed (not Active).
        if session.player != Pubkey::default() {
            require!(
                session.status != STATUS_ACTIVE,
                FlappyError::SessionAlreadyActive
            );
        }

        // ── CPI: player → vault (player is signer, no invoke_signed) ──
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            deposit_lamports,
        )?;

        // ── Write session state ──
        session.player = ctx.accounts.player.key();
        session.deposit_tier = tier;
        session.deposit_amount = deposit_lamports;
        session.status = STATUS_ACTIVE;
        session.max_claimable = 0; // server sets via cashout auth
        session.started_at = Clock::get()?.unix_timestamp;
        // Increment nonce to invalidate any stale authorizations
        session.nonce = session.nonce.checked_add(1).unwrap_or(1);
        session.last_auth_hash = [0u8; 32];
        session.auth_expiry = 0;
        session.bump = ctx.bumps.session;

        emit!(SessionCreated {
            player: session.player,
            tier,
            deposit_lamports,
            nonce: session.nonce,
        });
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // cashout — server-authorized payout
    // ────────────────────────────────────────────────────────────────────────

    /// Pays out earnings to the player (minus 10 % fee to treasury).
    ///
    /// The transaction **must** include an Ed25519 program instruction
    /// (at any index before this one) that verifies the server authority's
    /// signature over the canonical cashout message.
    ///
    /// # Arguments
    /// * `amount`        — lamports the player wants (≤ max_claimable).
    /// * `max_claimable` — server-authorized ceiling (signed in the auth).
    /// * `nonce`         — must match session.nonce.
    /// * `expiry`        — unix timestamp; tx rejected after this.
    ///
    /// # Guards (in order)
    /// 1. Session active
    /// 2. Signer == session.player
    /// 3. Nonce match (anti-replay)
    /// 4. Expiry not passed
    /// 5. amount ≤ max_claimable
    /// 6. amount > 0
    /// 7. Ed25519 signature verified (authority + message content)
    /// 8. Auth hash unique (double-spend prevention)
    /// 9. State updated BEFORE transfers (checks-effects-interactions)
    pub fn cashout(
        ctx: Context<Cashout>,
        amount: u64,
        max_claimable: u64,
        nonce: u64,
        expiry: i64,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;

        // 1. Session must be active
        require!(session.status == STATUS_ACTIVE, FlappyError::SessionNotActive);

        // 2. Signer must own the session
        require!(
            session.player == ctx.accounts.player.key(),
            FlappyError::UnauthorizedPlayer
        );

        // 3. Nonce must match — prevents replaying old authorizations
        require!(nonce == session.nonce, FlappyError::InvalidNonce);

        // 4. Authorization must not be expired
        let clock = Clock::get()?;
        require!(clock.unix_timestamp < expiry, FlappyError::AuthorizationExpired);

        // 5. Amount within authorized ceiling
        require!(amount <= max_claimable, FlappyError::AmountExceedsAuthorized);

        // 6. No zero-amount cashouts
        require!(amount > 0, FlappyError::ZeroCashout);

        // 7. Verify Ed25519 signature via instructions sysvar
        verify_ed25519_signature(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.config.authority,
            &ctx.accounts.player.key(),
            max_claimable,
            nonce,
            expiry,
            &crate::id(),
        )?;

        // 8. Replay check — auth hash must differ from last used
        let auth_hash = compute_auth_hash(
            &ctx.accounts.player.key(),
            max_claimable,
            nonce,
            expiry,
        );
        require!(session.last_auth_hash != auth_hash, FlappyError::ReplayDetected);

        // ── EFFECTS — update state before any transfers ──
        session.status = STATUS_CLOSED;
        session.max_claimable = max_claimable;
        session.last_auth_hash = auth_hash;
        session.auth_expiry = expiry;
        session.nonce = session.nonce.checked_add(1).unwrap_or(1);

        // ── FEE MATH ──
        let fee = amount
            .checked_mul(FEE_BPS)
            .ok_or(FlappyError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(FlappyError::MathOverflow)?;
        let player_payout = amount
            .checked_sub(fee)
            .ok_or(FlappyError::MathOverflow)?;

        // ── INTERACTIONS — CPI transfers from vault (invoke_signed) ──
        let vault_bump = ctx.accounts.config.vault_bump;
        let vault_seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

        // vault → player (90 %)
        if player_payout > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.player.to_account_info(),
                    },
                    signer_seeds,
                ),
                player_payout,
            )?;
        }

        // vault → treasury (10 %)
        if fee > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
            )?;
        }

        emit!(SessionCashedOut {
            player: ctx.accounts.player.key(),
            amount,
            fee,
            player_payout,
            nonce,
        });
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // force_close_on_death — authority kills a session, no payout
    // ────────────────────────────────────────────────────────────────────────

    /// Called by the game authority when a player dies.
    /// Deposit remains in vault (funds future payouts to winners).
    ///
    /// # Guards
    /// - Session must be active.
    /// - Signer must be the stored game authority.
    pub fn force_close_on_death(ctx: Context<ForceClose>) -> Result<()> {
        let session = &mut ctx.accounts.session;

        // GUARD: session must be active
        require!(session.status == STATUS_ACTIVE, FlappyError::SessionNotActive);

        // Authority signer check is handled by Anchor constraint below.
        // Close session — no payout, deposit stays in vault.
        session.status = STATUS_CLOSED;
        session.max_claimable = 0;
        session.nonce = session.nonce.checked_add(1).unwrap_or(1);

        emit!(SessionForceClosed {
            player: session.player,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}

// ============================================================================
// ACCOUNT STRUCTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Deployer/admin who pays for config account rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Game authority pubkey (server signing key).
    /// CHECK: Any valid pubkey; stored in config for later verification.
    pub authority: UncheckedAccount<'info>,

    /// Global config PDA — stores treasury, authority, bumps.
    #[account(
        init,
        payer = payer,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, VaultConfig>,

    /// Vault PDA — system-owned, holds deposited SOL.
    /// Not initialized (no data); just referenced so Anchor records the bump.
    /// CHECK: Derived from seeds; no data to validate.
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Player depositing SOL.
    #[account(mut)]
    pub player: Signer<'info>,

    /// Session PDA — created on first deposit, reused on subsequent ones.
    /// `init_if_needed` creates the account only if it doesn't exist yet.
    /// On recycled sessions (status=Closed) the fields are overwritten.
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Session::INIT_SPACE,
        seeds = [b"session", player.key().as_ref()],
        bump,
    )]
    pub session: Account<'info, Session>,

    /// Vault PDA that receives the deposit.
    /// CHECK: PDA verified by seeds + bump from config.
    #[account(
        mut,
        seeds = [b"vault"],
        bump = config.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// Program config (read vault_bump).
    #[account(
        seeds = [b"config"],
        bump = config.config_bump,
    )]
    pub config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cashout<'info> {
    /// Player cashing out — must match session.player.
    #[account(mut)]
    pub player: Signer<'info>,

    /// Player's session PDA.
    #[account(
        mut,
        seeds = [b"session", player.key().as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,

    /// Vault PDA — source of payout funds.
    /// CHECK: PDA verified by seeds + bump from config.
    #[account(
        mut,
        seeds = [b"vault"],
        bump = config.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// Treasury receives the 10 % fee.
    /// CHECK: Verified to match config.treasury via constraint.
    #[account(
        mut,
        constraint = treasury.key() == config.treasury @ FlappyError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,

    /// Program config.
    #[account(
        seeds = [b"config"],
        bump = config.config_bump,
    )]
    pub config: Account<'info, VaultConfig>,

    /// Instructions sysvar — used to read the Ed25519 verification instruction.
    /// CHECK: Address pinned to the sysvar ID.
    #[account(address = ix_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ForceClose<'info> {
    /// Game authority — must match config.authority.
    #[account(
        constraint = authority.key() == config.authority @ FlappyError::UnauthorizedAuthority,
    )]
    pub authority: Signer<'info>,

    /// The player's session to force-close.
    #[account(
        mut,
        seeds = [b"session", session.player.as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,

    /// Program config.
    #[account(
        seeds = [b"config"],
        bump = config.config_bump,
    )]
    pub config: Account<'info, VaultConfig>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    /// Wallet that receives 10 % fees.
    pub treasury: Pubkey, // 32
    /// Game server signing key (for cashout auth + death close).
    pub authority: Pubkey, // 32
    /// Bump for the vault PDA (seeds = ["vault"]).
    pub vault_bump: u8, // 1
    /// Bump for this config PDA (seeds = ["config"]).
    pub config_bump: u8, // 1
    // INIT_SPACE = 66
}

#[account]
#[derive(InitSpace)]
pub struct Session {
    /// Player pubkey.
    pub player: Pubkey, // 32
    /// Deposit tier (1 | 5 | 20).
    pub deposit_tier: u8, // 1
    /// Deposit in lamports.
    pub deposit_amount: u64, // 8
    /// 0 = Inactive (fresh), 1 = Active, 2 = Closed.
    pub status: u8, // 1
    /// Server-authorized max claimable lamports.
    pub max_claimable: u64, // 8
    /// Unix timestamp when session started.
    pub started_at: i64, // 8
    /// Monotonic counter; increments on deposit / cashout / death.
    pub nonce: u64, // 8
    /// SHA-256 of last consumed authorization (replay guard).
    pub last_auth_hash: [u8; 32], // 32
    /// Expiry timestamp of last authorization.
    pub auth_expiry: i64, // 8
    /// PDA bump.
    pub bump: u8, // 1
    // INIT_SPACE = 107
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct ConfigInitialized {
    pub treasury: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct SessionCreated {
    pub player: Pubkey,
    pub tier: u8,
    pub deposit_lamports: u64,
    pub nonce: u64,
}

#[event]
pub struct SessionCashedOut {
    pub player: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub player_payout: u64,
    pub nonce: u64,
}

#[event]
pub struct SessionForceClosed {
    pub player: Pubkey,
    pub authority: Pubkey,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum FlappyError {
    #[msg("Invalid deposit tier. Must be 1, 5, or 20.")]
    InvalidTier,
    #[msg("Session is already active. Cannot deposit again.")]
    SessionAlreadyActive,
    #[msg("Session is not active.")]
    SessionNotActive,
    #[msg("Signer is not the session player.")]
    UnauthorizedPlayer,
    #[msg("Caller is not the game authority.")]
    UnauthorizedAuthority,
    #[msg("Cashout amount exceeds authorized maximum.")]
    AmountExceedsAuthorized,
    #[msg("Authorization nonce does not match session nonce.")]
    InvalidNonce,
    #[msg("Cashout authorization has expired.")]
    AuthorizationExpired,
    #[msg("Cashout amount must be greater than zero.")]
    ZeroCashout,
    #[msg("Missing Ed25519 signature verification instruction.")]
    MissingEd25519Instruction,
    #[msg("Invalid Ed25519 instruction format.")]
    InvalidEd25519Instruction,
    #[msg("Ed25519 pubkey does not match game authority.")]
    InvalidAuthority,
    #[msg("Authorization message does not match expected parameters.")]
    InvalidAuthorizationMessage,
    #[msg("Replay detected: this authorization was already used.")]
    ReplayDetected,
    #[msg("Math overflow in fee calculation.")]
    MathOverflow,
    #[msg("Treasury account does not match config.")]
    InvalidTreasury,
}

// ============================================================================
// HELPERS
// ============================================================================

/// Scans instructions preceding the current one for a valid Ed25519
/// verification instruction from the expected authority over the expected
/// cashout message.
///
/// Security model:
///   The Ed25519 native program already verified the cryptographic signature
///   when the transaction was processed. If the signature were invalid the
///   transaction would have aborted before reaching our program. We therefore
///   only need to confirm:
///     (a) An Ed25519 instruction exists.
///     (b) Exactly one such instruction exists (prevent confusion attacks).
///     (c) The public key inside it matches our stored authority.
///     (d) The message inside it matches the expected cashout parameters.
///     (e) All data is embedded in the instruction itself (index = 0xFFFF).
fn verify_ed25519_signature(
    instructions_sysvar: &AccountInfo,
    expected_authority: &Pubkey,
    player: &Pubkey,
    max_claimable: u64,
    nonce: u64,
    expiry: i64,
    program_id: &Pubkey,
) -> Result<()> {
    let current_ix_index = ix_sysvar::load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(FlappyError::MissingEd25519Instruction))?;

    let mut found = false;

    for i in 0..current_ix_index as usize {
        let ix = ix_sysvar::load_instruction_at_checked(i, instructions_sysvar)
            .map_err(|_| error!(FlappyError::MissingEd25519Instruction))?;

        if ix.program_id != ed25519_program::id() {
            continue; // skip non-Ed25519 instructions (e.g. ComputeBudget)
        }

        // (b) Only one Ed25519 instruction allowed
        require!(!found, FlappyError::InvalidEd25519Instruction);
        found = true;

        let data = &ix.data;

        // Minimum size: 2 (header) + 14 (offsets) = 16, plus signature+pk+msg
        require!(data.len() > 112, FlappyError::InvalidEd25519Instruction);

        // Exactly 1 signature
        require!(data[0] == 1, FlappyError::InvalidEd25519Instruction);

        // ── Parse Ed25519SignatureOffsets (14 bytes at offset 2) ──
        //  [2..4]  signature_offset          u16 LE
        //  [4..6]  signature_instruction_idx  u16 LE
        //  [6..8]  public_key_offset         u16 LE
        //  [8..10] public_key_instruction_idx u16 LE
        // [10..12] message_data_offset       u16 LE
        // [12..14] message_data_size         u16 LE
        // [14..16] message_instruction_idx   u16 LE
        let _sig_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
        let sig_ix_idx = u16::from_le_bytes([data[4], data[5]]);
        let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
        let pk_ix_idx = u16::from_le_bytes([data[8], data[9]]);
        let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
        let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
        let msg_ix_idx = u16::from_le_bytes([data[14], data[15]]);

        // (e) All data must be embedded in this instruction (0xFFFF)
        require!(sig_ix_idx == u16::MAX, FlappyError::InvalidEd25519Instruction);
        require!(pk_ix_idx == u16::MAX, FlappyError::InvalidEd25519Instruction);
        require!(msg_ix_idx == u16::MAX, FlappyError::InvalidEd25519Instruction);

        // Bounds checks
        require!(
            data.len() >= pk_offset.saturating_add(32),
            FlappyError::InvalidEd25519Instruction
        );
        require!(
            data.len() >= msg_offset.saturating_add(msg_size),
            FlappyError::InvalidEd25519Instruction
        );

        // (c) Public key must match authority
        let pk_bytes = &data[pk_offset..pk_offset + 32];
        require!(
            pk_bytes == expected_authority.to_bytes().as_ref(),
            FlappyError::InvalidAuthority
        );

        // (d) Message must match expected cashout authorization
        let message = &data[msg_offset..msg_offset + msg_size];
        let expected_msg =
            build_cashout_message(player, max_claimable, nonce, expiry, program_id);
        require!(
            message.len() == expected_msg.len(),
            FlappyError::InvalidAuthorizationMessage
        );
        require!(
            message == expected_msg.as_slice(),
            FlappyError::InvalidAuthorizationMessage
        );
    }

    // (a) Must have found exactly one Ed25519 instruction
    require!(found, FlappyError::MissingEd25519Instruction);

    Ok(())
}

/// Builds the canonical 108-byte cashout authorization message.
///
/// Layout (all fixed-width, no length ambiguity):
///   [ 0..20)  DOMAIN_SEPARATOR       "FLAPPYONE_CASHOUT_V1"
///   [20..52)  player pubkey          32 bytes
///   [52..60)  max_claimable          u64 LE
///   [60..68)  nonce                  u64 LE
///   [68..76)  expiry                 i64 LE
///   [76..108) program_id             32 bytes
fn build_cashout_message(
    player: &Pubkey,
    max_claimable: u64,
    nonce: u64,
    expiry: i64,
    program_id: &Pubkey,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(108);
    msg.extend_from_slice(DOMAIN_SEPARATOR); //  20
    msg.extend_from_slice(player.as_ref()); //  32
    msg.extend_from_slice(&max_claimable.to_le_bytes()); //   8
    msg.extend_from_slice(&nonce.to_le_bytes()); //   8
    msg.extend_from_slice(&expiry.to_le_bytes()); //   8
    msg.extend_from_slice(program_id.as_ref()); //  32
    msg // 108
}

/// SHA-256 hash of authorization parameters.
/// Stored in `session.last_auth_hash` to prevent replaying the same auth.
fn compute_auth_hash(
    player: &Pubkey,
    max_claimable: u64,
    nonce: u64,
    expiry: i64,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(56);
    data.extend_from_slice(player.as_ref()); // 32
    data.extend_from_slice(&max_claimable.to_le_bytes()); //  8
    data.extend_from_slice(&nonce.to_le_bytes()); //  8
    data.extend_from_slice(&expiry.to_le_bytes()); //  8
    hash::hash(&data).to_bytes()
}
