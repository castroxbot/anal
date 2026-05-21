export function isDevWallet(wallet: string, creatorWallet?: string | null): boolean {
  if (!creatorWallet) return false;
  return wallet === creatorWallet;
}
