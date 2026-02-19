#!/bin/bash
# ============================================================================
# Flappy.one — WSL Toolchain Setup
# Run this INSIDE your WSL Ubuntu terminal (not PowerShell)
# ============================================================================
set -e

echo "=== [1/5] Installing Rust ==="
if command -v rustc &>/dev/null; then
    echo "Rust already installed: $(rustc --version)"
else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "Rust installed: $(rustc --version)"
fi

echo ""
echo "=== [2/5] Installing Solana CLI ==="
if command -v solana &>/dev/null; then
    echo "Solana CLI already installed: $(solana --version)"
else
    sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.18/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    # Persist to shell profile
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
    echo "Solana CLI installed: $(solana --version)"
fi

echo ""
echo "=== [3/5] Installing Anchor CLI ==="
if command -v anchor &>/dev/null; then
    echo "Anchor already installed: $(anchor --version)"
else
    cargo install --git https://github.com/coral-xyz/anchor avm --force
    avm install 0.30.1
    avm use 0.30.1
    echo "Anchor installed: $(anchor --version)"
fi

echo ""
echo "=== [4/5] Configuring Solana for devnet ==="
solana config set --url devnet

# Generate deployer keypair if it doesn't exist
if [ ! -f ~/.config/solana/id.json ]; then
    echo "Generating deployer keypair..."
    solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase
else
    echo "Deployer keypair already exists."
fi

echo "Deployer address: $(solana-keygen pubkey)"
echo ""

echo "=== [5/5] Airdropping devnet SOL ==="
echo "Requesting 5 SOL..."
solana airdrop 5 || echo "Airdrop may have failed (rate limited). Try again manually: solana airdrop 2"
sleep 2
solana airdrop 5 || true

echo ""
echo "Balance: $(solana balance)"
echo ""
echo "============================================"
echo "  SETUP COMPLETE"
echo "  Next: cd to your project and run:"
echo "    cd /mnt/c/Users/<YOUR_WINDOWS_USER>/Downloads/flappyone_matrix_hackathon/flappy.one"
echo "    bash build-and-deploy.sh"
echo "============================================"
