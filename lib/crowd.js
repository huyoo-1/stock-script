// 拥挤度算法：成交额前 5% 个股集中度（设计 §11.2）。
// 纯函数，无 I/O。

// constituents: [{ code, name, amount }]
function computeCrowding(constituents, thresholds) {
  // 1. 过滤成交额为 0 或无效的股票（停牌）
  const valid = constituents.filter((r) => r.amount != null && r.amount > 0);

  if (valid.length === 0) {
    return { crowding: null, level: 'unknown', validCount: 0, topCount: 0, numerator: 0, denominator: 0 };
  }

  // 2. 按成交额降序排序
  const sorted = [...valid].sort((a, b) => b.amount - a.amount);

  // 3. 前 5% 数量（向上取整）
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.05));

  // 4. 分子 = 前 topCount 之和
  const top = sorted.slice(0, topCount);
  const numerator = top.reduce((s, r) => s + r.amount, 0);

  // 5. 分母 = 全部有效之和
  const denominator = sorted.reduce((s, r) => s + r.amount, 0);

  // 6. 拥挤度 = 分子/分母 × 100%
  const crowding = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

  return {
    crowding,
    level: levelOf(crowding, thresholds),
    validCount: sorted.length,
    topCount,
    numerator: Math.round(numerator * 100) / 100,
    denominator: Math.round(denominator * 100) / 100,
    topStocks: top.map((r) => ({ code: r.code, name: r.name, amount: r.amount })),
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
