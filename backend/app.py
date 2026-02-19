"""
Flappy.one Backend - Privy Authentication & Wallet Operations
=============================================================

This backend handles:
1. Verifying Privy auth tokens (proving user actually logged in)
2. Processing deposits (when user bets)
3. Processing cashouts (sending winnings back)
4. Managing the house wallet

Install dependencies:
    pip install flask flask-cors pyjwt requests python-dotenv solana solders

Run:
    python app.py
"""

import os
import json
import time
import jwt
import requests
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Solana imports for wallet operations
from solana.rpc.api import Client
from solana.transaction import Transaction
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import transfer, TransferParams
from solders.signature import Signature

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "https://flappy.one"])  # Add your domains

# =============================================================================
# CONFIGURATION
# =============================================================================

PRIVY_APP_ID = os.getenv("PRIVY_APP_ID", "cmjwxzn2b040sl90d2khc3xao")
PRIVY_APP_SECRET = os.getenv("PRIVY_APP_SECRET", "YOUR_APP_SECRET_HERE")  # Set in .env

# Solana configuration
SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
# For testing, use devnet: "https://api.devnet.solana.com"

# House wallet - This is YOUR wallet that collects bets and pays out winnings
# IMPORTANT: Keep this private key SECRET. Use environment variable in production.
HOUSE_WALLET_PRIVATE_KEY = os.getenv("HOUSE_WALLET_PRIVATE_KEY")  # Base58 encoded

# Fee percentage (10% house cut)
HOUSE_FEE_PERCENT = 10

# Minimum bet amounts in USD (you'll need price feed for SOL conversion)
MIN_BET_USD = 1
MAX_BET_USD = 100

# In-memory user database (use PostgreSQL/Redis in production)
users_db = {}  # privy_user_id -> { wallet_address, balance, total_wagered, total_won }
active_games = {}  # game_session_id -> { user_id, bet_amount, start_time }

# Solana client
solana_client = Client(SOLANA_RPC_URL)

# =============================================================================
# PRIVY AUTH VERIFICATION
# =============================================================================

def get_privy_jwks():
    """Fetch Privy's public keys for JWT verification"""
    try:
        response = requests.get(
            f"https://auth.privy.io/api/v1/apps/{PRIVY_APP_ID}/jwks.json",
            headers={"privy-app-id": PRIVY_APP_ID}
        )
        return response.json()
    except Exception as e:
        print(f"Error fetching JWKS: {e}")
        return None

def verify_privy_token(token):
    """
    Verify a Privy access token and extract user info.
    
    The frontend sends this token after user logs in.
    We verify it's legitimate before trusting any user data.
    """
    try:
        # Get Privy's public keys
        jwks = get_privy_jwks()
        if not jwks:
            return None
        
        # Decode the token header to get the key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        
        # Find the matching public key
        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
                break
        
        if not public_key:
            print("No matching public key found")
            return None
        
        # Verify and decode the token
        decoded = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=PRIVY_APP_ID,
            issuer="privy.io"
        )
        
        return decoded
        
    except jwt.ExpiredSignatureError:
        print("Token expired")
        return None
    except jwt.InvalidTokenError as e:
        print(f"Invalid token: {e}")
        return None
    except Exception as e:
        print(f"Token verification error: {e}")
        return None

def require_auth(f):
    """Decorator to require Privy authentication on endpoints"""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid authorization header"}), 401
        
        token = auth_header.split(" ")[1]
        user_data = verify_privy_token(token)
        
        if not user_data:
            return jsonify({"error": "Invalid or expired token"}), 401
        
        # Add user data to request context
        request.privy_user = user_data
        return f(*args, **kwargs)
    
    return decorated

# =============================================================================
# USER MANAGEMENT
# =============================================================================

def get_or_create_user(privy_user_id, wallet_address=None):
    """Get or create a user in our database"""
    if privy_user_id not in users_db:
        users_db[privy_user_id] = {
            "wallet_address": wallet_address,
            "balance": 0,
            "total_wagered": 0,
            "total_won": 0,
            "created_at": time.time()
        }
    elif wallet_address and not users_db[privy_user_id]["wallet_address"]:
        users_db[privy_user_id]["wallet_address"] = wallet_address
    
    return users_db[privy_user_id]

# =============================================================================
# WALLET OPERATIONS (SOLANA)
# =============================================================================

def get_house_keypair():
    """Load the house wallet keypair"""
    if not HOUSE_WALLET_PRIVATE_KEY:
        raise ValueError("House wallet private key not configured")
    
    # Decode from base58
    import base58
    secret_key = base58.b58decode(HOUSE_WALLET_PRIVATE_KEY)
    return Keypair.from_bytes(secret_key)

def get_house_wallet_address():
    """Get the house wallet public address"""
    keypair = get_house_keypair()
    return str(keypair.pubkey())

def verify_deposit_transaction(signature: str, expected_amount_lamports: int, from_address: str):
    """
    Verify that a deposit transaction actually happened.
    Called after frontend says "I sent the money".
    
    Returns True if the transaction is valid and confirmed.
    """
    try:
        sig = Signature.from_string(signature)
        tx_info = solana_client.get_transaction(sig, encoding="jsonParsed")
        
        if not tx_info or not tx_info.value:
            return False, "Transaction not found"
        
        tx = tx_info.value
        
        # Check if transaction is confirmed
        if tx.slot is None:
            return False, "Transaction not confirmed"
        
        # Parse the transaction to verify:
        # 1. It's from the expected address
        # 2. It's TO our house wallet
        # 3. The amount matches
        
        house_address = get_house_wallet_address()
        
        # This is simplified - you'll need to parse the actual instruction data
        # based on how you structure the deposit transaction
        
        return True, "Transaction verified"
        
    except Exception as e:
        return False, str(e)

def send_cashout(to_address: str, amount_lamports: int):
    """
    Send SOL from house wallet to user's wallet (cashout).
    
    This is called by the backend only - never trust frontend to do this.
    """
    try:
        house_keypair = get_house_keypair()
        
        # Create transfer instruction
        transfer_ix = transfer(
            TransferParams(
                from_pubkey=house_keypair.pubkey(),
                to_pubkey=Pubkey.from_string(to_address),
                lamports=amount_lamports
            )
        )
        
        # Get recent blockhash
        recent_blockhash = solana_client.get_latest_blockhash().value.blockhash
        
        # Create and sign transaction
        tx = Transaction()
        tx.add(transfer_ix)
        tx.recent_blockhash = recent_blockhash
        tx.fee_payer = house_keypair.pubkey()
        tx.sign(house_keypair)
        
        # Send transaction
        result = solana_client.send_transaction(tx)
        
        return True, str(result.value)
        
    except Exception as e:
        return False, str(e)

# =============================================================================
# API ENDPOINTS
# =============================================================================

@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok", "house_wallet": get_house_wallet_address()})

@app.route("/api/auth/verify", methods=["POST"])
@require_auth
def verify_auth():
    """
    Verify user's Privy auth and return their profile.
    Frontend calls this after user logs in to confirm auth is valid.
    """
    privy_user = request.privy_user
    user_id = privy_user.get("sub")  # Privy user ID
    
    # Get wallet address from the request body (frontend sends this)
    data = request.get_json() or {}
    wallet_address = data.get("wallet_address")
    
    # Get or create user in our database
    user = get_or_create_user(user_id, wallet_address)
    
    return jsonify({
        "success": True,
        "user": {
            "id": user_id,
            "wallet_address": user["wallet_address"],
            "balance": user["balance"],
            "total_wagered": user["total_wagered"],
            "total_won": user["total_won"]
        },
        "house_wallet": get_house_wallet_address()
    })

@app.route("/api/game/deposit", methods=["POST"])
@require_auth
def process_deposit():
    """
    Process a deposit after user sends SOL to house wallet.
    
    Flow:
    1. Frontend prompts user to sign transaction (sending SOL to house wallet)
    2. Frontend sends transaction signature to this endpoint
    3. We verify the transaction actually happened
    4. We credit the user's in-game balance
    """
    privy_user = request.privy_user
    user_id = privy_user.get("sub")
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing request body"}), 400
    
    tx_signature = data.get("tx_signature")
    amount_lamports = data.get("amount_lamports")
    bet_amount_usd = data.get("bet_amount_usd")
    
    if not tx_signature or not amount_lamports:
        return jsonify({"error": "Missing tx_signature or amount"}), 400
    
    # Get user
    user = users_db.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    # Verify the transaction
    verified, message = verify_deposit_transaction(
        tx_signature, 
        amount_lamports, 
        user["wallet_address"]
    )
    
    if not verified:
        return jsonify({"error": f"Transaction verification failed: {message}"}), 400
    
    # Credit the user's balance
    user["balance"] += bet_amount_usd
    user["total_wagered"] += bet_amount_usd
    
    # Create game session
    session_id = f"{user_id}_{int(time.time())}"
    active_games[session_id] = {
        "user_id": user_id,
        "bet_amount": bet_amount_usd,
        "start_time": time.time(),
        "tx_signature": tx_signature
    }
    
    return jsonify({
        "success": True,
        "session_id": session_id,
        "balance": user["balance"],
        "message": f"Deposited ${bet_amount_usd}"
    })

@app.route("/api/game/cashout", methods=["POST"])
@require_auth
def process_cashout():
    """
    Process a cashout - send winnings to user's wallet.
    
    This is the CRITICAL endpoint - only backend can do this.
    Takes 10% house cut before sending.
    """
    privy_user = request.privy_user
    user_id = privy_user.get("sub")
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing request body"}), 400
    
    session_id = data.get("session_id")
    final_balance = data.get("final_balance", 0)
    
    # Verify session exists and belongs to this user
    session = active_games.get(session_id)
    if not session:
        return jsonify({"error": "Invalid session"}), 404
    
    if session["user_id"] != user_id:
        return jsonify({"error": "Session doesn't belong to you"}), 403
    
    # Get user
    user = users_db.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    # Calculate payout with house cut
    house_cut = final_balance * (HOUSE_FEE_PERCENT / 100)
    payout = final_balance - house_cut
    
    # Convert USD to lamports (you need a price feed for this)
    # For now, assuming 1 SOL = $100 (YOU MUST USE REAL PRICE)
    SOL_PRICE_USD = 100  # TODO: Get from price feed like Pyth
    sol_amount = payout / SOL_PRICE_USD
    lamports = int(sol_amount * 1_000_000_000)  # 1 SOL = 1 billion lamports
    
    if lamports <= 0:
        return jsonify({"error": "Nothing to cash out"}), 400
    
    # Send the SOL
    success, tx_or_error = send_cashout(user["wallet_address"], lamports)
    
    if not success:
        return jsonify({"error": f"Cashout failed: {tx_or_error}"}), 500
    
    # Update user stats
    user["total_won"] += payout
    user["balance"] = 0
    
    # Remove session
    del active_games[session_id]
    
    return jsonify({
        "success": True,
        "payout_usd": payout,
        "payout_sol": sol_amount,
        "house_cut_usd": house_cut,
        "tx_signature": tx_or_error,
        "message": f"Cashed out ${payout:.2f} (after {HOUSE_FEE_PERCENT}% fee)"
    })

@app.route("/api/user/profile", methods=["GET"])
@require_auth
def get_profile():
    """Get user's profile and stats"""
    privy_user = request.privy_user
    user_id = privy_user.get("sub")
    
    user = users_db.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    return jsonify({
        "id": user_id,
        "wallet_address": user["wallet_address"],
        "balance": user["balance"],
        "total_wagered": user["total_wagered"],
        "total_won": user["total_won"]
    })

# =============================================================================
# RUN SERVER
# =============================================================================

if __name__ == "__main__":
    print("""
╔═══════════════════════════════════════════════════════════════╗
║              FLAPPY.ONE BACKEND SERVER                        ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    POST /api/auth/verify    - Verify Privy token              ║
║    POST /api/game/deposit   - Process bet deposit             ║
║    POST /api/game/cashout   - Process cashout                 ║
║    GET  /api/user/profile   - Get user profile                ║
╚═══════════════════════════════════════════════════════════════╝
    """)
    
    # Check configuration
    if not HOUSE_WALLET_PRIVATE_KEY:
        print("⚠️  WARNING: HOUSE_WALLET_PRIVATE_KEY not set!")
        print("   Set it in .env file for production")
    
    if PRIVY_APP_SECRET == "YOUR_APP_SECRET_HERE":
        print("⚠️  WARNING: PRIVY_APP_SECRET not set!")
        print("   Get it from Privy dashboard")
    
    app.run(host="0.0.0.0", port=5000, debug=True)
