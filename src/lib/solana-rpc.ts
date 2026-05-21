import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com';
const WS_URL = process.env.SOLANA_WS_URL || 'wss://solana-rpc.publicnode.com';

// Singleton connection
let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_URL, {
      wsEndpoint: WS_URL,
      commitment: 'confirmed',
    });
  }
  return _connection;
}

// PumpFun program IDs
export const PUMPFUN_PROGRAM_ID = new PublicKey(
  process.env.PUMPFUN_PROGRAM_ID || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
);

export const RAYDIUM_PROGRAM_ID = new PublicKey(
  process.env.RAYDIUM_PROGRAM_ID || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
);

export const PUMPFUN_MIGRATION_PROGRAM = new PublicKey(
  process.env.PUMPFUN_MIGRATION_PROGRAM || '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg'
);

// Get current slot
export async function getCurrentSlot(): Promise<number> {
  const conn = getConnection();
  return conn.getSlot();
}

// Get SOL balance for a wallet
export async function getSolBalance(address: string): Promise<number> {
  const conn = getConnection();
  const pk = new PublicKey(address);
  const lamports = await conn.getBalance(pk);
  return lamports / 1e9;
}

// Get token supply
export async function getTokenSupply(mint: string): Promise<number> {
  const conn = getConnection();
  const pk = new PublicKey(mint);
  const supply = await conn.getTokenSupply(pk);
  return supply.value.uiAmount || 0;
}

// Fetch a parsed transaction
export async function getParsedTransaction(
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  const conn = getConnection();
  return conn.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
}

// Fetch multiple parsed transactions
export async function getParsedTransactions(
  signatures: string[]
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const conn = getConnection();
  return conn.getParsedTransactions(signatures, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
}

// Check if an address is a valid Solana public key
export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Subscribe to program account changes (for real-time migration detection)
// This returns a cleanup function
export function subscribeToProgramLogs(
  programId: PublicKey,
  callback: (logs: string[], signature: string) => void
): () => void {
  const conn = getConnection();
  
  const id = conn.onLogs(
    programId,
    (logs) => {
      if (!logs.err) {
        callback(logs.logs, logs.signature);
      }
    },
    'confirmed'
  );

  return () => {
    conn.removeOnLogsListener(id);
  };
}

// Calculate market cap from token price and supply
export function calculateMarketCap(
  pricePerToken: number,
  totalSupply: number
): number {
  return pricePerToken * totalSupply;
}

// Parse SOL amount from lamports
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

// Format address for display
export function shortAddress(address: string): string {
  if (!address || address.length < 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
