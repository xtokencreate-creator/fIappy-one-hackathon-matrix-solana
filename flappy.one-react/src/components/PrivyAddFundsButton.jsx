import { usePrivy } from '@privy-io/react-auth';
import { useFundWallet, useWallets, useCreateWallet } from '@privy-io/react-auth/solana';

/**
 * Opens Privy's funding modal (Solana) for the user's embedded wallet.
 * - If not logged in -> shows Privy login modal first.
 * - If user has no embedded wallet yet -> creates one, then opens funding modal.
 */
export default function PrivyAddFundsButton({ className = '' }) {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { fundWallet } = useFundWallet();

  const onAddFunds = async () => {
    try {
      if (!ready) return;
      if (!authenticated) {
        await login();
        return;
      }

      // Prefer Privy's embedded wallet if present.
      let wallet = wallets?.find(
        (candidate) =>
          candidate?.walletClientType === 'privy' ||
          candidate?.isPrivyWallet ||
          candidate?.wallet?.isPrivyWallet ||
          candidate?.standardWallet?.name === 'Privy',
      ) ?? wallets?.[0];

      // If none exist, create an embedded wallet.
      if (!wallet) {
        wallet = await createWallet({ createAdditional: false });
      }

      if (!wallet?.address) {
        alert('No wallet address found.');
        return;
      }

      await fundWallet({ address: wallet.address, chain: 'solana:mainnet' });
    } catch (e) {
      console.error('Add funds error:', e);
      alert('Could not open Add Funds. Check console for details.');
    }
  };

  return (
    <button className={className} onClick={onAddFunds}>
      ADD FUNDS
    </button>
  );
}
