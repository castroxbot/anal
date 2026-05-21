export interface MigratedCoin {
  id: string;
  mint: string;
  name: string | null;
  symbol: string | null;
  migrationTxSig: string | null;
  migratedAt: string;
  marketCapAtMigration: number | null;
  currentMarketCap: number | null;
  raydiumPoolId: string | null;
  earlyBuyerCount?: number;
  tradeCount?: number;
}

export interface Trade {
  id: string;
  mint: string;
  wallet: string;
  type: 'BUY' | 'SELL';
  solAmount: number;
  tokenAmount: number;
  priceUsd: number | null;
  signature: string;
  timestamp: string;
  slot: number | null;
}

export interface EarlyBuyer {
  id: string;
  mint: string;
  wallet: string;
  buyAmountSol: number;
  buyAmountUsd: number | null;
  marketCapAtBuy: number | null;
  isEarly: boolean;
  rank: number | null;
  walletScore?: number;
  walletTier?: WalletTier;
  labelled?: string;
}

export type WalletTier = 'ELITE' | 'SMART' | 'AVERAGE' | 'POOR' | 'UNKNOWN';

export interface WalletScore {
  address: string;
  score: number;
  tier: WalletTier;
  earlyBuyCount: number;
  winRate: number;
  avgMultiple: number;
  totalPnlSol: number;
  rugCount: number;
  totalTrades: number;
  labelled: string | null;
  lastActive: string | null;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  earlyBuyScore: number;     // 0-30: how often buys early
  winRateScore: number;      // 0-25: win rate
  multipleScore: number;     // 0-25: average return multiple
  activityScore: number;     // 0-10: consistent activity
  rugAvoidScore: number;     // 0-10: avoids rugs
}

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  accountData: AccountData[];
  type: string;
  source: string;
  description: string;
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  decimals: number;
  mint: string;
}

export interface AccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: TokenBalanceChange[];
}

export interface TokenBalanceChange {
  userAccount: string;
  tokenAccount: string;
  mint: string;
  rawTokenAmount: {
    tokenAmount: string;
    decimals: number;
  };
}

export interface HeliusTokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  externalUrl?: string;
}

export interface SSEMessage {
  type: 'NEW_MIGRATION' | 'NEW_TRADE' | 'SCORE_UPDATE' | 'HEARTBEAT';
  data: MigratedCoin | Trade | WalletScore | null;
  timestamp: number;
}

export interface CoinTradesResponse {
  coin: MigratedCoin;
  trades: Trade[];
  earlyBuyers: EarlyBuyer[];
  stats: {
    totalBuys: number;
    totalSells: number;
    uniqueBuyers: number;
    earlyBuyerCount: number;
    avgBuySol: number;
  };
}
