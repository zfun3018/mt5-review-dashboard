const DAY = 86_400_000;

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
export function createSyntheticDataset() {
  const start = Date.UTC(2026, 0, 5);
  let balance = 100_000;
  let peak = balance;
  const equity = [];

  for (let index = 0; index < 90; index += 1) {
    const drift = 94 + Math.sin(index / 4.2) * 210 + Math.cos(index / 8.7) * 125;
    const shock = index % 17 === 0 ? -720 : index % 23 === 0 ? 830 : 0;
    balance += drift + shock;
    peak = Math.max(peak, balance);
    equity.push({
      date: new Date(start + index * DAY).toISOString().slice(0, 10),
      equity: round(balance),
      drawdown: round(((balance - peak) / peak) * 100),
    });
  }

  const monthly = [
    {month: "1月", pnl: 2680}, {month: "2月", pnl: -1240}, {month: "3月", pnl: 4120},
    {month: "4月", pnl: 1890}, {month: "5月", pnl: -760}, {month: "6月", pnl: 5340},
    {month: "7月", pnl: 2960}, {month: "8月", pnl: 4380}, {month: "9月", pnl: -1680},
    {month: "10月", pnl: 6240},
  ];

  return Object.freeze({
    summary: Object.freeze({
      netPnl: 23930,
      returnRate: 23.93,
      maxDrawdown: -4.72,
      profitFactor: 1.84,
      winRate: 57.6,
      trades: 118,
    }),
    equity: Object.freeze(equity),
    monthly: Object.freeze(monthly),
    strategies: Object.freeze([
      {name: "趋势跟随", pnl: 10840},
      {name: "突破确认", pnl: 7420},
      {name: "区间反转", pnl: 3860},
      {name: "事件驱动", pnl: 2410},
      {name: "试错单", pnl: -600},
    ]),
    risk: Object.freeze({
      score: 78,
      riskPerTrade: 0.82,
      lossStreak: 3,
      exposure: 36,
      reviewCoverage: 84,
    }),
  });
}
