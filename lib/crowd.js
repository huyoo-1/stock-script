// 拥挤度算法：成交额前 5% 个股集中度（设计 §11.2）。
// 纯函数，无 I/O。

// 新口径（2026-08-02 修正）：
// 分子 = 全 A 成交额前 5% 中属于该市场/指数的股票成交额之和
// 分母 = 该市场/指数全部有效成交额之和
// 这样计算出的拥挤度与主流软件（同花顺/通达信）的"大盘拥挤度"口径一致。
//
// 参数：
//   allShares: [{ code, name, market, amount }] 全 A 股
//   marketShares: [{ code, name, amount }] 该市场/指数成分股
//   thresholds: { normal, warning }
//   belongs: (allShareRow) => boolean 判定该股票是否属于该市场/指数
function computeCrowding(allShares, marketShares, thresholds, belongs) {
  // 1. 过滤该市场有效股票（停牌 amount=0 的剔除）
  const validMarket = marketShares.filter((r) => r.amount != null && r.amount > 0);
  if (validMarket.length === 0) {
    return { crowding: null, level: 'unknown', validCount: 0, topCount: 0, numerator: 0, denominator: 0, topStocks: [] };
  }

  // 2. 分母 = 该市场有效成交额之和
  const denominator = validMarket.reduce((s, r) => s + r.amount, 0);

  // 3. 全 A 按成交额降序，取前 5%（向上取整）
  const sortedAll = [...allShares].filter((r) => r.amount != null && r.amount > 0).sort((a, b) => b.amount - a.amount);
  const topCount = Math.max(1, Math.ceil(sortedAll.length * 0.05));
  const topAll = sortedAll.slice(0, topCount);

  // 4. 分子 = 全 A 前 5% 中属于该市场的股票成交额之和
  const topMarket = topAll.filter(belongs);
  const numerator = topMarket.reduce((s, r) => s + r.amount, 0);

  // 5. 拥挤度
  const crowding = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

  return {
    crowding,
    level: levelOf(crowding, thresholds),
    validCount: validMarket.length,
    topCount: topMarket.length,
    numerator: Math.round(numerator * 100) / 100,
    denominator: Math.round(denominator * 100) / 100,
    topStocks: topMarket.map((r) => ({ code: r.code, name: r.name, amount: r.amount })),
  };
}

function levelOf(crowding, thresholds) {
  if (crowding == null) return 'unknown';
  if (crowding < thresholds.normal) return 'normal';
  if (crowding < thresholds.warning) return 'watch';
  return 'warning';
}

// 较上一快照的变化（↑/↓ 百分点）
function deltaText(current, previous) {
  if (previous == null || current == null) return null;
  const diff = Math.round((current - previous) * 100) / 100;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  return `${arrow}${Math.abs(diff).toFixed(2)}`;
}

const LEVEL_EMOJI = { normal: '✅', watch: '⚠️', warning: '🔴', unknown: '❓' };
const LEVEL_LABEL = { normal: '正常', watch: '关注区', warning: '预警区', unknown: '未知' };

module.exports = { computeCrowding, levelOf, deltaText, LEVEL_EMOJI, LEVEL_LABEL };
