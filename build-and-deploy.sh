#!/bin/bash
# ============================================================================
# Flappy.one — Build, Deploy, and Initialize
# Run INSIDE WSL from the project root:
#   cd /mnt/c/Users/<YOUR_WINDOWS_USER>/Downloads/flappyone_matrix_hackathon/flappy.one
#   bash build-and-deploy.sh
# ============================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "=== [1/6] Building Anchor program ==="
anchor build

echo ""
echo "=== [2/6] Getting program ID ==="
PROGRAM_ID=$(anchor keys list | grep flappy_one | awk '{print $3}')
echo "Program ID: $PROGRAM_ID"

echo ""
echo "=== [3/6] Updating program ID in source files ==="

# Update lib.rs
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" \
    programs/flappy_one/src/lib.rs
echo "  Updated lib.rs"

# Update Anchor.toml
sed -i "s/flappy_one = \"[^\"]*\"/flappy_one = \"$PROGRAM_ID\"/" \
    Anchor.toml
echo "  Updated Anchor.toml"

echo ""
echo "=== [4/6] Rebuilding with correct program ID ==="
anchor build

echo ""
echo "=== [5/6] Deploying to devnet ==="
echo "Deployer: $(solana-keygen pubkey)"
echo "Balance:  $(solana balance)"
echo ""
anchor deploy --provider.cluster devnet

echo ""
echo "=== [6/6] Generating authority keypair ==="
AUTHORITY_KEYPAIR="$PROJECT_DIR/authority-keypair.json"
if [ ! -f "$AUTHORITY_KEYPAIR" ]; then
    solana-keygen new --outfile "$AUTHORITY_KEYPAIR" --no-bip39-passphrase
    echo "Authority keypair created: $AUTHORITY_KEYPAIR"
else
    echo "Authority keypair already exists: $AUTHORITY_KEYPAIR"
fi

AUTHORITY_PUBKEY=$(solana-keygen pubkey "$AUTHORITY_KEYPAIR")
AUTHORITY_SECRET_B64=$(node -e "const k=require('$AUTHORITY_KEYPAIR'); console.log(Buffer.from(k).toString('base64'))" 2>/dev/null || python3 -c "import json,base64; k=json.load(open('$AUTHORITY_KEYPAIR')); print(base64.b64encode(bytes(k)).decode())")

echo ""
echo "============================================"
echo "  DEPLOYMENT COMPLETE"
echo ""
echo "  Program ID:       $PROGRAM_ID"
echo "  Authority Pubkey:  $AUTHORITY_PUBKEY"
echo "  Authority Secret:  (base64, first 20 chars) ${AUTHORITY_SECRET_B64:0:20}..."
echo ""
echo "  Next step: Initialize the program."
echo "  Run:  bash initialize-program.sh"
echo ""
echo "  Then update your .env files:"
echo "    FLAPPY_PROGRAM_ID=$PROGRAM_ID"
echo "    AUTHORITY_SECRET_KEY=$AUTHORITY_SECRET_B64"
echo "    VITE_FLAPPY_PROGRAM_ID=$PROGRAM_ID"
echo "============================================"
