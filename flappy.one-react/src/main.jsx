import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { createSolanaRpc, createSolanaRpcSubscriptions, mainnet } from '@solana/kit'
import App from './App'
import { PRIVY_ALLOWED_WALLETS, PRIVY_LOGIN_METHODS } from './lib/privyAuthConfig'

globalThis.Buffer = Buffer

const privyId = import.meta.env.VITE_PRIVY_APP_ID
const solanaRpc = import.meta.env.VITE_SOLANA_RPC_URL
const fallbackSolanaRpc = 'https://api.mainnet-beta.solana.com'
const solanaRpcUrl = solanaRpc || fallbackSolanaRpc
const solanaWsUrl = solanaRpcUrl.startsWith('http')
  ? solanaRpcUrl.replace(/^http/, 'ws')
  : solanaRpcUrl

const solanaRpcClient = createSolanaRpc(mainnet(solanaRpcUrl))
const solanaRpcSubscriptions = createSolanaRpcSubscriptions(mainnet(solanaWsUrl))
const SOLANA_MAINNET_CAIP2 = 'solana:mainnet'
const solanaConnectors = toSolanaWalletConnectors({
  defaultChain: SOLANA_MAINNET_CAIP2,
  solana: { rpcUrl: solanaRpcUrl },
})

// console.log("PRIVY ID =", privyId)
// console.log("SOLANA RPC =", solanaRpcUrl)

ReactDOM.createRoot(document.getElementById('root')).render(
  <PrivyProvider
    appId={privyId}
    config={{
      // Dashboard parity checklist:
      // - Enable: Email, Wallet
      // - Disable: Socials, SMS, Passkeys, other auth methods
      embeddedWallets: {
        createOnLogin: 'off',
      },
      loginMethods: PRIVY_LOGIN_METHODS,
      loginMethodsAndOrder: {
        primary: ['email', 'jupiter'],
      },
      appearance: {
        walletList: PRIVY_ALLOWED_WALLETS,
        walletChainType: 'solana-only',
        showWalletLoginFirst: false,
      },
      externalWallets: {
        solana: {
          connectors: solanaConnectors,
        },
      },
      solana: {
        rpcs: {
          [SOLANA_MAINNET_CAIP2]: {
            rpc: solanaRpcClient,
            rpcSubscriptions: solanaRpcSubscriptions,
            blockExplorerUrl: 'https://explorer.solana.com',
          },
        },
      },
    }}
  >
    <App />
  </PrivyProvider>
)
