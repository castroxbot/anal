import { WalletScore, WalletTier, ScoreBreakdown, EarlyBuyer, Trade } from '@/types';

// Score weights
const WEIGHTS = {
  EARLY_BUY: 30,    // How often they buy before 15k mcap
  WIN_RATE: 25,     // % of coins they profit from
  MULTIPLE: 25,     // Average return multiple
  ACTIVITY: 10,     // Consistent trading activity
  RUG_AVOID: 10,    // Avoids rugs / slow rugs
};

export interface WalletHistory {
  address: string;
  trades: Trade[];
  earlyBuys: EarlyBuyer[];
  totalTrades: number;
  profitableTrades: number;
  totalPnlSol: number;
  rugCount: number;
  avgMultiple: number;
}

// Calculate score for a wallet based on its trading history
export function scoreWallet(history: WalletHistory): WalletScore {
  const breakdown = calculateBreakdown(history);
  const rawScore =
    breakdown.earlyBuyScore +
    breakdown.winRateScore +
    breakdown.multipleScore +
    breakdown.activityScore +
    breakdown.rugAvoidScore;

  const score = Math.min(100, Math.max(0, rawScore));
  const tier = getTier(score);
  const winRate = history.totalTrades > 0
    ? (history.profitableTrades / history.totalTrades) * 100
    : 0;

  return {
    address: history.address,
    score,
    tier,
    earlyBuyCount: history.earlyBuys.filter(b => b.isEarly).length,
    winRate,
    avgMultiple: history.avgMultiple,
    totalPnlSol: history.totalPnlSol,
    rugCount: history.rugCount,
    totalTrades: history.totalTrades,
    labelled: detectLabel(history),
    lastActive: history.trades.length > 0
      ? history.trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0].timestamp
      : null,
    breakdown,
  };
}

function calculateBreakdown(history: WalletHistory): ScoreBreakdown {
  // 1. Early buy score (0-30)
  // Score based on ratio of early buys (<15k mcap) to total buys
  const buyTrades = history.trades.filter(t => t.type === 'BUY');
  const earlyBuys = history.earlyBuys.filter(b => b.isEarly);
  const earlyBuyRatio = buyTrades.length > 0 ? earlyBuys.length / buyTrades.length : 0;
  const earlyBuyScore = Math.min(WEIGHTS.EARLY_BUY, earlyBuyRatio * WEIGHTS.EARLY_BUY);

  // 2. Win rate score (0-25)
  const winRate = history.totalTrades > 0
    ? history.profitableTrades / history.totalTrades
    : 0;
  let winRateScore = 0;
  if (winRate >= 0.7) winRateScore = WEIGHTS.WIN_RATE;
  else if (winRate >= 0.5) winRateScore = WEIGHTS.WIN_RATE * 0.7;
  else if (winRate >= 0.3) winRateScore = WEIGHTS.WIN_RATE * 0.4;
  else winRateScore = 0;

  // 3. Multiple score (0-25)
  let multipleScore = 0;
  if (history.avgMultiple >= 10) multipleScore = WEIGHTS.MULTIPLE;
  else if (history.avgMultiple >= 5) multipleScore = WEIGHTS.MULTIPLE * 0.8;
  else if (history.avgMultiple >= 3) multipleScore = WEIGHTS.MULTIPLE * 0.6;
  else if (history.avgMultiple >= 2) multipleScore = WEIGHTS.MULTIPLE * 0.4;
  else if (history.avgMultiple >= 1) multipleScore = WEIGHTS.MULTIPLE * 0.2;
  else multipleScore = 0;

  // 4. Activity score (0-10)
  // Reward consistent, not too-spammy activity
  let activityScore = 0;
  if (history.totalTrades >= 50) activityScore = WEIGHTS.ACTIVITY;
  else if (history.totalTrades >= 20) activityScore = WEIGHTS.ACTIVITY * 0.8;
  else if (history.totalTrades >= 10) activityScore = WEIGHTS.ACTIVITY * 0.5;
  else if (history.totalTrades >= 3) activityScore = WEIGHTS.ACTIVITY * 0.3;

  // Penalize bots (too many trades = likely bot)
  if (history.totalTrades > 500) activityScore *= 0.5;

  // 5. Rug avoidance score (0-10)
  const rugRatio = history.totalTrades > 0 ? history.rugCount / history.totalTrades : 0;
  let rugAvoidScore = WEIGHTS.RUG_AVOID;
  if (rugRatio > 0.5) rugAvoidScore = 0;
  else if (rugRatio > 0.3) rugAvoidScore = WEIGHTS.RUG_AVOID * 0.3;
  else if (rugRatio > 0.1) rugAvoidScore = WEIGHTS.RUG_AVOID * 0.6;
  else rugAvoidScore = WEIGHTS.RUG_AVOID;

  return {
    earlyBuyScore: Math.round(earlyBuyScore * 10) / 10,
    winRateScore: Math.round(winRateScore * 10) / 10,
    multipleScore: Math.round(multipleScore * 10) / 10,
    activityScore: Math.round(activityScore * 10) / 10,
    rugAvoidScore: Math.round(rugAvoidScore * 10) / 10,
  };
}

export function getTier(score: number): WalletTier {
  if (score >= 80) return 'ELITE';
  if (score >= 60) return 'SMART';
  if (score >= 40) return 'AVERAGE';
  if (score >= 20) return 'POOR';
  return 'UNKNOWN';
}

export function getTierColor(tier: WalletTier): string {
  switch (tier) {
    case 'ELITE': return '#FFD700';   // Gold
    case 'SMART': return '#00FF88';   // Green
    case 'AVERAGE': return '#4FC3F7'; // Blue
    case 'POOR': return '#FF6B35';    // Orange
    default: return '#8B949E';        // Gray
  }
}

export function getTierEmoji(tier: WalletTier): string {
  switch (tier) {
    case 'ELITE': return '👑';
    case 'SMART': return '🧠';
    case 'AVERAGE': return '📊';
    case 'POOR': return '💸';
    default: return '❓';
  }
}

// Detect common wallet patterns
function detectLabel(history: WalletHistory): string | null {
  const buyTrades = history.trades.filter(t => t.type === 'BUY');
  
  // Bot detection: many trades in short time
  if (history.totalTrades > 200) {
    const timestamps = history.trades
      .map(t => new Date(t.timestamp).getTime())
      .sort((a, b) => a - b);
    
    if (timestamps.length > 1) {
      const avgTimeBetween = (timestamps[timestamps.length - 1] - timestamps[0]) / timestamps.length;
      if (avgTimeBetween < 5000) return 'bot'; // < 5 seconds average = bot
    }
  }

  // Sniper: buys very early consistently and sells quickly
  const earlyBuyRatio = buyTrades.length > 0
    ? history.earlyBuys.filter(b => b.isEarly).length / buyTrades.length
    : 0;
  
  if (earlyBuyRatio > 0.8 && history.totalTrades > 10) return 'sniper';

  // Insider: extremely early + high win rate
  if (
    earlyBuyRatio > 0.9 &&
    history.profitableTrades / Math.max(1, history.totalTrades) > 0.8
  ) return 'insider';

  // Whale: large average trade size
  const avgTradeSol = history.trades.reduce((sum, t) => sum + t.solAmount, 0) / Math.max(1, history.trades.length);
  if (avgTradeSol > 10) return 'whale';

  return null;
}

// Score a wallet from raw Helius trade data
export function buildWalletHistoryFromTrades(
  address: string,
  trades: Trade[],
  earlyBuys: EarlyBuyer[]
): WalletHistory {
  const walletTrades = trades.filter(
    t => t.wallet.toLowerCase() === address.toLowerCase()
  );

  // Simple PnL calculation
  const coinGroups: Record<string, { buys: Trade[]; sells: Trade[] }> = {};
  for (const trade of walletTrades) {
    if (!coinGroups[trade.mint]) coinGroups[trade.mint] = { buys: [], sells: [] };
    if (trade.type === 'BUY') coinGroups[trade.mint].buys.push(trade);
    else coinGroups[trade.mint].sells.push(trade);
  }

  let profitableTrades = 0;
  let totalPnlSol = 0;
  let totalMultiple = 0;
  let countedCoins = 0;

  for (const [, group] of Object.entries(coinGroups)) {
    const totalBought = group.buys.reduce((s, t) => s + t.solAmount, 0);
    const totalSold = group.sells.reduce((s, t) => s + t.solAmount, 0);
    const pnl = totalSold - totalBought;
    
    if (totalBought > 0) {
      const multiple = totalSold / totalBought;
      totalMultiple += multiple;
      countedCoins++;
      totalPnlSol += pnl;
      if (pnl > 0) profitableTrades++;
    }
  }

  return {
    address,
    trades: walletTrades,
    earlyBuys: earlyBuys.filter(b => b.wallet === address),
    totalTrades: walletTrades.length,
    profitableTrades,
    totalPnlSol,
    rugCount: 0, // Would need more data
    avgMultiple: countedCoins > 0 ? totalMultiple / countedCoins : 0,
  };
}
