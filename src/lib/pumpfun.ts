import { PublicKey } from '@solana/web3.js';
import { PUMPFUN_PROGRAM_ID } from '@/lib/solana-rpc';
import { isPumpTokenMint } from '@/lib/token-filters';
import { HeliusTransaction } from '@/types';

export { isPumpTokenMint } from '@/lib/token-filters';

// Pump global defaults (raw units: lamports / 6-decimal tokens)
export const INITIAL_VIRTUAL_SOL_LAMPORTS = BigInt(30_000_000_000);
export const INITIAL_VIRTUAL_TOKEN_RAW = BigInt('1073000000000000');
const TOKEN_TOTAL_SUPPLY_RAW = BigInt('1000000000000000');
const TOKEN_DECIMALS = 6;

export const EARLY_BUY_THRESHOLD_USD = 15_000;

export function getBondingCurveAddress(mint: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
    PUMPFUN_PROGRAM_ID
  )[0];
}

/** Pick the actual meme token mint from a migration tx (not WSOL/USDC) */
export function pickMigrationMint(
  tokenTransfers: Array<{ mint?: string; tokenAmount?: number }> | undefined
): string | null {
  if (!tokenTransfers?.length) return null;

  const volumeByMint = new Map<string, number>();
  for (const t of tokenTransfers) {
    if (!t.mint || !isPumpTokenMint(t.mint)) continue;
    volumeByMint.set(t.mint, (volumeByMint.get(t.mint) || 0) + (t.tokenAmount || 0));
  }

  if (volumeByMint.size === 0) return null;

  return Array.from(volumeByMint.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

export function marketCapUsdFromReserves(
  virtualSolLamports: bigint,
  virtualTokenRaw: bigint,
  solPriceUsd: number
): number {
  if (virtualTokenRaw <= BigInt(0)) return 0;
  const marketCapLamports = (virtualSolLamports * TOKEN_TOTAL_SUPPLY_RAW) / virtualTokenRaw;
  return (Number(marketCapLamports) / 1e9) * solPriceUsd;
}

export function applyBuyToReservesState(
  virtualSolLamports: bigint,
  virtualTokenRaw: bigint,
  buy: { solAmount: number; tokenAmount: number }
): { virtualSolLamports: bigint; virtualTokenRaw: bigint } {
  const solLamports = BigInt(Math.round(buy.solAmount * 1e9));
  const tokensRaw = BigInt(Math.round(buy.tokenAmount * 10 ** TOKEN_DECIMALS));
  return applyBuyToReserves(virtualSolLamports, virtualTokenRaw, solLamports, tokensRaw);
}

function applyBuyToReserves(
  virtualSolLamports: bigint,
  virtualTokenRaw: bigint,
  solInLamports: bigint,
  tokensOutRaw: bigint
): { virtualSolLamports: bigint; virtualTokenRaw: bigint } {
  if (solInLamports > BigInt(0)) {
    const k = virtualSolLamports * virtualTokenRaw;
    const newVirtualSol = virtualSolLamports + solInLamports;
    const newVirtualToken = newVirtualSol > BigInt(0) ? k / newVirtualSol : virtualTokenRaw;
    return {
      virtualSolLamports: newVirtualSol,
      virtualTokenRaw: newVirtualToken > BigInt(0) ? newVirtualToken : virtualTokenRaw,
    };
  }

  if (tokensOutRaw > BigInt(0) && tokensOutRaw < virtualTokenRaw) {
    return {
      virtualSolLamports,
      virtualTokenRaw: virtualTokenRaw - tokensOutRaw,
    };
  }

  return { virtualSolLamports, virtualTokenRaw };
}

export interface ParsedPumpTrade {
  wallet: string;
  type: 'BUY' | 'SELL';
  solAmount: number;
  tokenAmount: number;
  signature: string;
  timestamp: string;
}

export function parsePumpTradesFromTxs(
  txs: HeliusTransaction[],
  mint: string,
  bondingCurveAddress: string
): ParsedPumpTrade[] {
  const trades: ParsedPumpTrade[] = [];
  const tradeKeys = new Set<string>();

  for (const tx of txs) {
    for (const transfer of tx.tokenTransfers || []) {
      if (transfer.mint !== mint) continue;

      const sides: Array<{ wallet: string; type: 'BUY' | 'SELL' }> = [];

      if (
        transfer.toUserAccount &&
        transfer.toUserAccount !== bondingCurveAddress &&
        transfer.toUserAccount !== mint
      ) {
        sides.push({ wallet: transfer.toUserAccount, type: 'BUY' });
      }

      if (
        transfer.fromUserAccount &&
        transfer.fromUserAccount !== bondingCurveAddress &&
        transfer.fromUserAccount !== mint
      ) {
        sides.push({ wallet: transfer.fromUserAccount, type: 'SELL' });
      }

      for (const { wallet, type } of sides) {
        const key = `${tx.signature}:${wallet}:${type}`;
        if (tradeKeys.has(key)) continue;
        tradeKeys.add(key);

        const solAmount = getSolAmountForWallet(tx, wallet, type);

        trades.push({
          wallet,
          type,
          solAmount,
          tokenAmount: Math.abs(transfer.tokenAmount || 0),
          signature: tx.signature,
          timestamp: new Date(tx.timestamp * 1000).toISOString(),
        });
      }
    }
  }

  return trades;
}

function getSolAmountForWallet(
  tx: HeliusTransaction,
  wallet: string,
  type: 'BUY' | 'SELL'
): number {
  const account = tx.accountData?.find(a => a.account === wallet);
  if (account?.nativeBalanceChange) {
    const sol = Math.abs(account.nativeBalanceChange) / 1e9;
    if (sol > 0) return sol;
  }

  let total = 0;
  for (const t of tx.nativeTransfers || []) {
    if (type === 'BUY' && t.fromUserAccount === wallet) {
      total += Math.abs(t.amount) / 1e9;
    } else if (type === 'SELL' && t.toUserAccount === wallet) {
      total += Math.abs(t.amount) / 1e9;
    }
  }
  return total;
}

export interface EarlyBuyerResult {
  wallet: string;
  solAmount: number;
  rank: number;
  marketCapAtBuy: number;
}

/** Walk bonding-curve buys in time order; flag wallets that bought below $15k mcap */
// 🟢 Update your EarlyBuyerResult interface and detectEarlyBuyers function:
export interface EarlyBuyerResult {
  wallet: string;
  solAmount: number;
  rank: number;
  marketCapAtBuy: number;
  soldAmountSol: number;
  realizedPnlSol: number;
  hasSold: boolean;
  lastSoldAt: Date | null;
}

export function detectEarlyBuyers(
  trades: ParsedPumpTrade[],
  solPriceUsd: number
): EarlyBuyerResult[] {
  // Sort chronologically
  const sorted = [...trades].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const earlyBuyersMap = new Map<string, EarlyBuyerResult>();
  const seenWallets = new Set<string>();
  let earlyBuyerRank = 1;

  for (const trade of sorted) {
    const mcapAtTrade = (trade as any).mcapAtTrade || EARLY_BUY_THRESHOLD_USD;
    const isAlreadyFlagged = earlyBuyersMap.has(trade.wallet);

    // 1. Capture the initial buy entry point
    if (trade.type === 'BUY' && mcapAtTrade < EARLY_BUY_THRESHOLD_USD && !seenWallets.has(trade.wallet)) {
      seenWallets.add(trade.wallet);
      earlyBuyersMap.set(trade.wallet, {
        wallet: trade.wallet,
        solAmount: trade.solAmount,
        rank: earlyBuyerRank++,
        marketCapAtBuy: mcapAtTrade,
        soldAmountSol: 0,
        realizedPnlSol: 0,
        hasSold: false,
        lastSoldAt: null,
      });
    }

    else if (trade.type === 'BUY' && isAlreadyFlagged) {
      const buyerData = earlyBuyersMap.get(trade.wallet)!;
      buyerData.solAmount += trade.solAmount;
    }
    else if (trade.type === 'SELL' && isAlreadyFlagged) {
      const buyerData = earlyBuyersMap.get(trade.wallet)!;
      buyerData.soldAmountSol += trade.solAmount;
      buyerData.realizedPnlSol = buyerData.soldAmountSol - buyerData.solAmount;
      buyerData.hasSold = true;
      buyerData.lastSoldAt = new Date(trade.timestamp);
    }
  }

  return Array.from(earlyBuyersMap.values());
}
