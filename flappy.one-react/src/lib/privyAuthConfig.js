export const PRIVY_ALLOWED_WALLETS = ['jupiter'];
export const PRIVY_LOGIN_METHODS = ['email', 'wallet'];

export function isPrivyWalletConfigLocked() {
  return (
    Array.isArray(PRIVY_ALLOWED_WALLETS) &&
    PRIVY_ALLOWED_WALLETS.length === 1 &&
    PRIVY_ALLOWED_WALLETS[0] === 'jupiter'
  );
}
