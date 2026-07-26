// 宽基 ETF 成交额异动（国家队代理）：当日/前一日成交额放大倍数。
const em = require('./emData');

// whitelist: ['510300', ...]，prevClose: 上一交易日收盘记录（含 etf 数组）
async function fetchEtfFlows(http, whitelist, prevClose, surgeRatio, logger) {
  const prevMap = {};
  if (prevClose && Array.isArray(prevClose.etf)) {
    for (const e of prevClose.etf) prevMap[e.code] = e.todayAmountYi;
  }

  const results = [];
  for (const code of whitelist) {
    try {
      const q = await em.fetchEtfQuote(http, code);
      if (!q) {
        results.push({ code, name: '', todayAmountYi: null, surge: null, tag: '数据缺失' });
        continue;
      }
      const todayYi = Math.round((q.amount / 1e8) * 100) / 100; // 元 → 亿元
      const prevYi = prevMap[code];
      const surge = prevYi && prevYi > 0 ? Math.round((todayYi / prevYi) * 100) / 100 : null;
      const tag = surge != null && surge >= surgeRatio ? '疑似国家队' : '—';
      results.push({ code, name: q.name, todayAmountYi: todayYi, surge, tag });
    } catch (e) {
      logger && logger.warn(`ETF ${code} 拉取失败`, e.message);
      results.push({ code, name: '', todayAmountYi: null, surge: null, tag: '数据缺失' });
    }
  }
  return results;
}

module.exports = { fetchEtfFlows };
