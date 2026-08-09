// 技术面筛选：连续 N 日上涨 + 现价 ≥ MA5 且 MA5 > MA10（纯函数，无 I/O）。
// 输入来自 priceHistory 的日快照；停牌日（close=null）不计入有效交易日。
const MA5_DAYS = 5;
const MA10_DAYS = 10;

// 最近 n 日均线；样本不足返回 null
function ma(closes, n) {
  if (!Array.isArray(closes) || closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((s, c) => s + c, 0) / n;
}

// 最近 n 个有效交易日是否连续收涨（closes 为升序）
function consecutiveUp(closes, n) {
  if (!Array.isArray(closes) || closes.length < n) return false;
  const last = closes.slice(-n);
  for (let i = 1; i < last.length; i++) {
    if (!(last[i] > last[i - 1])) return false;
  }
  return true;
}

// 筛选：连续 upDays 日上涨 且 现价>=MA5 且 MA5>MA10
// daysData: [{ date, rows: [{ code, name, close }] }]，按日期升序
function runScreener(daysData, { upDays = 3 } = {}) {
  // 按 code 聚合收盘序列（升序）
  const map = new Map();
  for (const day of daysData) {
    for (const r of day.rows) {
      if (r.close == null) continue;
      let s = map.get(r.code);
      if (!s) {
        s = { code: r.code, name: r.name || '', closes: [] };
        map.set(r.code, s);
      }
      s.closes.push(r.close);
      if (!s.name) s.name = r.name || '';
    }
  }

  const results = [];
  for (const s of map.values()) {
    const closes = s.closes;
    if (closes.length < MA10_DAYS) continue; // MA10 样本不足（含新股/长期停牌）
    const ma5 = ma(closes, MA5_DAYS);
    const ma10 = ma(closes, MA10_DAYS);
    const price = closes[closes.length - 1];
    if (ma5 == null || ma10 == null) continue;
    if (!(price >= ma5)) continue;
    if (!(ma5 > ma10)) continue;
    if (!consecutiveUp(closes, upDays)) continue;
    results.push({
      code: s.code,
      name: s.name,
      close: Math.round(price * 100) / 100,
      ma5: Math.round(ma5 * 100) / 100,
      ma10: Math.round(ma10 * 100) / 100,
    });
  }
  results.sort((a, b) => b.close - a.close);
  return results;
}

// 有效交易日数量（用于提示数据积累进度）
function readyDays(daysData) {
  return daysData.filter((d) => Array.isArray(d.rows) && d.rows.length > 0).length;
}

module.exports = { ma, consecutiveUp, runScreener, readyDays, MA5_DAYS, MA10_DAYS };
