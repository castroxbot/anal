/** Quote / system mints that appear in txs but are not PumpFun tokens */
export const EXCLUDED_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

export function isPumpTokenMint(mint: string): boolean {
  return Boolean(mint) && !EXCLUDED_MINTS.has(mint);
}
