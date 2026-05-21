import { HeliusTransaction, HeliusTokenMetadata } from '@/types';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL!;
const BASE_URL = `https://api.helius.xyz/v0`;

// Fetch parsed transactions for a given address
export async function getTransactionHistory(
  address: string,
  options: {
    limit?: number;
    before?: string;
    until?: string;
    type?: string;
  } = {}
): Promise<HeliusTransaction[]> {
  const params = new URLSearchParams({
    'api-key': HELIUS_API_KEY,
    limit: String(options.limit || 100),
    ...(options.before && { before: options.before }),
    ...(options.until && { until: options.until }),
    ...(options.type && { type: options.type }),
  });

  const res = await fetch(
    `${BASE_URL}/addresses/${address}/transactions?${params}`,
    { next: { revalidate: 0 } }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Helius transactions error: ${err}`);
  }

  return res.json();
}

// Fetch parsed transactions by signatures
export async function getTransactionsBySignatures(
  signatures: string[]
): Promise<HeliusTransaction[]> {
  if (signatures.length === 0) return [];

  const res = await fetch(`${BASE_URL}/transactions?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signatures }),
  });

  if (!res.ok) {
    throw new Error(`Helius parse error: ${await res.text()}`);
  }

  return res.json();
}

// Token metadata via Helius DAS API
export async function getTokenMetadata(mints: string[]): Promise<HeliusTokenMetadata[]> {
  if (mints.length === 0) return [];

  const res = await fetch(HELIUS_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'metadata',
      method: 'getAssetBatch',
      params: { ids: mints },
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Helius DAS error: ${json.error.message}`);

  return (json.result || []).map((asset: any) => ({
    mint: asset.id,
    name: asset.content?.metadata?.name || 'Unknown',
    symbol: asset.content?.metadata?.symbol || '???',
    description: asset.content?.metadata?.description,
    image: asset.content?.links?.image,
  }));
}

// Get token accounts (holders) for a mint
export async function getTokenHolders(mint: string): Promise<{ address: string; amount: number }[]> {
  const res = await fetch(HELIUS_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'holders',
      method: 'getTokenLargestAccounts',
      params: [mint],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Helius holders error: ${json.error.message}`);

  return (json.result?.value || []).map((acc: any) => ({
    address: acc.address,
    amount: parseFloat(acc.uiAmountString || '0'),
  }));
}

// Fetch signatures for a program/address (for migration detection)
export async function getSignaturesForAddress(
  address: string,
  limit = 20
): Promise<{ signature: string; slot: number; blockTime: number }[]> {
  const res = await fetch(HELIUS_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'sigs',
      method: 'getSignaturesForAddress',
      params: [address, { limit }],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Signatures error: ${json.error.message}`);
  return json.result || [];
}

// Get SOL/USD price via Helius
export async function getSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { next: { revalidate: 60 } }
    );
    const data = await res.json();
    return data?.solana?.usd || 150;
  } catch {
    return 150; // fallback
  }
}

// Get recent PumpFun migrations by querying the migration program
export async function getRecentMigrations(limit = 20): Promise<{
  signature: string;
  mint: string;
  timestamp: number;
  slot: number;
}[]> {
  const MIGRATION_PROGRAM = process.env.PUMPFUN_MIGRATION_PROGRAM!;
  
  try {
    const sigs = await getSignaturesForAddress(MIGRATION_PROGRAM, limit);
    const txSigs = sigs.map(s => s.signature);
    
    if (txSigs.length === 0) return [];
    
    const txs = await getTransactionsBySignatures(txSigs);
    
    const migrations: { signature: string; mint: string; timestamp: number; slot: number }[] = [];
    
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      // Find the new token mint from token transfers
      const mints = new Set(tx.tokenTransfers?.map((t: any) => t.mint).filter(Boolean));
      
      for (const mint of mints) {
        migrations.push({
          signature: tx.signature,
          mint: mint as string,
          timestamp: tx.timestamp,
          slot: sigs[i]?.slot || 0,
        });
      }
    }
    
    return migrations;
  } catch (error) {
    console.error('Error fetching migrations:', error);
    return [];
  }
}

// Fetch all trades for a specific token mint
export async function getTradesForMint(
  mint: string,
  limit = 200
): Promise<HeliusTransaction[]> {
  try {
    // Get token-related transactions via Helius enhanced API
    const params = new URLSearchParams({
      'api-key': HELIUS_API_KEY,
      limit: String(limit),
      type: 'SWAP',
    });

    const res = await fetch(
      `${BASE_URL}/addresses/${mint}/transactions?${params}`,
      { next: { revalidate: 30 } }
    );

    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
