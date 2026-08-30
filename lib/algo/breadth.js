// 市场广度算法：涨跌家数、涨跌停家数、两市总成交额 + 活跃度分级。
// 移植自参考 akshare_fetcher.py:1824-1911 / efinance_fetcher.py:974-1061。

// 北交所代码判定（参考 base.py:254-272）
function isBseCode(code) {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) return false;
  if (code.startsWith('900')) return false;
  return ['92', '43', '81', '82', '83', '87', '88'].some((p) => code.startsWith(p));
}

// 科创板(688)/创业板(30)
function isKcCyStock(code) {
  return code.startsWith('688') || code.startsWith('30');
}

// ST 股（参考 base.py:274-281）
function isStStock(name) {
  return name && name.toUpperCase().includes('ST');
}

// 涨跌停比例（参考 base.py:254-292）
function limitRatio(code, name) {
  if (isBseCode(code)) return 0.30;
  if (isKcCyStock(code)) return 0.20;
  if (isStStock(name)) return 0.05;
  return 0.10;
}

// 涨停价 = floor(preClose*(1+ratio)*100+0.5)/100（参考 akshare_fetcher.py:1873）
function limitUpPrice(preClose, ratio) {
  return Math.floor(preClose * (1 + ratio) * 100 + 0.5) / 100;
}

// 跌停价 = floor(preClose*(1-ratio)*100+0.5)/100
function limitDownPrice(preClose, ratio) {
  return Math.floor(preClose * (1 - ratio) * 100 + 0.5) / 100;
}

// 容差 = abs(preClose*(1+ratio) - limitPrice)（参考 akshare_fetcher.py:1876）
function tolerance(preClose, ratio, limitPrice) {
  return Math.abs(preClose * (1 + ratio) - limitPrice);
}

// 计算广度
// rows: [{ code, name, price, preClose, amount }]
function computeBreadth(rows) {
  let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0, totalAmount = 0;

  for (const r of rows) {
    // 停牌过滤（参考 akshare_fetcher.py:1852）
    if (r.price == null || r.preClose == null || r.preClose === 0 || r.amount === 0) continue;

    const ratio = limitRatio(r.code, r.name);
    const lu = limitUpPrice(r.preClose, ratio);
    const ld = limitDownPrice(r.preClose, ratio);
    const tolUp = tolerance(r.preClose, ratio, lu);
    const tolDn = tolerance(r.preClose, -ratio, ld);

    if (r.price > 0) {
      if (Math.abs(r.price - lu) <= tolUp) limitUp++;
      if (Math.abs(r.price - ld) <= tolDn) limitDown++;
      if (r.price > r.preClose) up++;
      else if (r.price < r.preClose) down++;
      else flat++;
    }
    totalAmount += r.amount;
  }

  return {
    up,
    down,
    flat,
    limitUp,
    limitDown,
    totalAmountYi: Math.round((totalAmount / 1e8) * 100) / 100, // 元 → 亿元，2 位小数
  };
}

// 活跃度分级（设计 §2.6）
function activityTier(totalAmountYi) {
  if (totalAmountYi >= 15000) return '高活跃';
  if (totalAmountYi >= 9000) return '中等活跃';
  return '缩量观望';
}

module.exports = {
  isBseCode, isKcCyStock, isStStock, limitRatio,
  limitUpPrice, limitDownPrice, tolerance,
  computeBreadth, activityTier,
};
