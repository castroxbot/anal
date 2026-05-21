import { ConfirmedSignatureInfo, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import { getConnection } from '@/lib/solana-rpc';
import { MIN_BUY_SOL } from '@/lib/constants';
import {
  getBondingCurveAddress,
  ParsedPumpTrade,
  marketCapUsdFromReserves,
  EARLY_BUY_THRESHOLD_USD,
  applyBuyToReservesState,
  INITIAL_VIRTUAL_SOL_LAMPORTS,
  INITIAL_VIRTUAL_TOKEN_RAW,
} from '@/lib/pumpfun';

const POST_MIGRATION_BUFFER_SEC = 300;
const TX_DELAY_MS = 80;
const MAX_SIGNATURE_PAGES = 30;
const SIGS_PER_PAGE = 1000;

export interface FetchPumpTradesOptions {
  migratedAt?: Date;
}

function resolvePubkey(key: unknown): string {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object') {
    const k = key as { pubkey?: string | { toBase58?: () => string } };
    if (typeof k.pubkey === 'string') return k.pubkey;
    if (k.pubkey && typeof k.pubkey.toBase58 === 'function') return k.pubkey.toBase58();
  }
  return '';
}

function getAccountKeys(tx: ParsedTransactionWithMeta): string[] {
  const message = tx.transaction.message as {
    accountKeys?: unknown[];
    staticAccountKeys?: PublicKey[];
  };

  if (message.accountKeys?.length) {
    return message.accountKeys.map(resolvePubkey).filter(Boolean);
  }
  if (message.staticAccountKeys?.length) {
    return message.staticAccountKeys.map(k => k.toBase58());
  }
  return [];
}

function solDeltaForOwner(tx: ParsedTransactionWithMeta, owner: string): number {
  const meta = tx.meta;
  if (!meta) return 0;

  const keys = getAccountKeys(tx);
  const idx = keys.indexOf(owner);
  if (idx >= 0 && meta.preBalances[idx] != null && meta.postBalances[idx] != null) {
    return Math.abs(meta.preBalances[idx] - meta.postBalances[idx]) / 1e9;
  }

  return 0;
}

/** Parse buys from RPC pre/post token balances */
export function parseBuysFromParsedTx(
  tx: ParsedTransactionWithMeta | null,
  mint: string,
  bondingCurve: string
): ParsedPumpTrade[] {
  if (!tx?.meta || tx.meta.err) return [];

  const rawSig = tx.transaction.signatures?.[0];
  const signature = typeof rawSig === 'string' ? rawSig : rawSig ? String(rawSig) : '';
  if (!signature) return [];

  const timestamp = tx.blockTime
    ? new Date(tx.blockTime * 1000).toISOString()
    : new Date().toISOString();

  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];
  const buys: ParsedPumpTrade[] = [];
  const seen = new Set<string>();

  for (const postBal of post) {
    if (postBal.mint !== mint) continue;

    const owner = postBal.owner;
    if (!owner || owner === bondingCurve) continue;

    const preBal = pre.find(p => p.accountIndex === postBal.accountIndex);
    const preAmt = preBal?.uiTokenAmount?.uiAmount ?? 0;
    const postAmt = postBal.uiTokenAmount?.uiAmount ?? 0;
    const delta = (postAmt ?? 0) - (preAmt ?? 0);

    if (delta <= 1e-12) continue;

    const key = `${signature}:${owner}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let solAmount = solDeltaForOwner(tx, owner);
    if (solAmount < 0.000_001) {
      const feePayer = getAccountKeys(tx)[0];
      if (feePayer === owner) solAmount = solDeltaForOwner(tx, feePayer);
    }

    if (solAmount < MIN_BUY_SOL) continue;

    buys.push({
      wallet: owner,
      type: 'BUY',
      solAmount,
      tokenAmount: delta,
      signature,
      timestamp,
    });
  }

  return buys;
}

/** Paginate bonding-curve signatures until migration (newest pages → oldest) */
async function collectPreMigrationSignatures(
  bondingCurve: PublicKey,
  migratedAt?: Date
): Promise<ConfirmedSignatureInfo[]> {
  const conn = getConnection();
  const cutoffSec = migratedAt
    ? Math.floor(migratedAt.getTime() / 1000) + POST_MIGRATION_BUFFER_SEC
    : undefined;

  const collected: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  let pagesPastMigration = 0;

  for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
    const batch = await conn.getSignaturesForAddress(bondingCurve, {
      limit: SIGS_PER_PAGE,
      before,
    });

    if (batch.length === 0) break;

    let included = 0;
    for (const sig of batch) {
      if (sig.err) continue;
      if (cutoffSec && sig.blockTime && sig.blockTime > cutoffSec) continue;
      collected.push(sig);
      included++;
    }

    const oldest = batch[batch.length - 1];
    before = oldest.signature;

    if (included === 0 && cutoffSec) {
      pagesPastMigration++;
      if (pagesPastMigration > 15) break;
    } else {
      pagesPastMigration = 0;
    }

    if (batch.length < SIGS_PER_PAGE) break;
    if (cutoffSec && oldest.blockTime && oldest.blockTime < cutoffSec - 86_400 * 30) break;
  }

  // Chronological order (oldest first) for bonding-curve walk
  return collected.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
}

/**
 * Fetch all bonding-curve BUYs until market cap crosses $15k (early-buyer phase only).
 * Stops parsing once the curve passes the threshold — no need for later trades.
 */
export async function fetchEarlyBondingCurveBuys(
  mint: string,
  solPriceUsd: number,
  options: FetchPumpTradesOptions = {}
): Promise<ParsedPumpTrade[]> {
  const bondingCurve = getBondingCurveAddress(mint);
  const bondingCurveStr = bondingCurve.toBase58();
  const conn = getConnection();

  const signatures = await collectPreMigrationSignatures(
    bondingCurve,
    options.migratedAt
  );

  if (signatures.length === 0) return [];

  let virtualSol = INITIAL_VIRTUAL_SOL_LAMPORTS;
  let virtualToken = INITIAL_VIRTUAL_TOKEN_RAW;
  const earlyBuys: ParsedPumpTrade[] = [];

  for (const sigInfo of signatures) {
    const mcapNow = marketCapUsdFromReserves(virtualSol, virtualToken, solPriceUsd);
    if (mcapNow >= EARLY_BUY_THRESHOLD_USD) break;

    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await conn.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch {
      await new Promise(r => setTimeout(r, TX_DELAY_MS));
      continue;
    }

    const buys = parseBuysFromParsedTx(tx, mint, bondingCurveStr);
    for (const buy of buys) {
      const mcapAtBuy = marketCapUsdFromReserves(virtualSol, virtualToken, solPriceUsd);

      if (mcapAtBuy < EARLY_BUY_THRESHOLD_USD) {
        earlyBuys.push(buy);
      }

      const state = applyBuyToReservesState(virtualSol, virtualToken, buy);
      virtualSol = state.virtualSolLamports;
      virtualToken = state.virtualTokenRaw;

      if (marketCapUsdFromReserves(virtualSol, virtualToken, solPriceUsd) >= EARLY_BUY_THRESHOLD_USD) {
        break;
      }
    }

    await new Promise(r => setTimeout(r, TX_DELAY_MS));
  }

  return earlyBuys;
}

/** @deprecated Use fetchEarlyBondingCurveBuys for early-buyer analysis */
export async function fetchPumpBondingCurveTrades(
  mint: string,
  options: FetchPumpTradesOptions & { maxSignatures?: number } = {}
): Promise<ParsedPumpTrade[]> {
  const solPrice = 150;
  return fetchEarlyBondingCurveBuys(mint, solPrice, options);
}
