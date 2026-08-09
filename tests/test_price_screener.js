// tests/test_price_screener.js
// 本地验证：priceHistory 落盘/读取 + screener 筛选逻辑（不联网）。
// 使用 2025 年假日期，跑完自动清理测试文件，不影响真实积累的数据。
// 用法: node tests/test_price_screener.js
const path = require('path');
const fs = require('fs');
const priceHistory = require('../lib/priceHistory');
const screener = require('../lib/screener');

// 12 个交易日（够算 MA10）
const DATES = [
  '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08',
  '2025-01-09', '2025-01-10', '2025-01-13', '2025-01-14', '2025-01-15',
  '2025-01-16', '2025-01-17',
];

// 每只股票的收盘价序列（与 DATES 一一对应；null = 当日停牌/无数据）
const STOCKS = {
  // 600001：连续3日上涨 + 价>=MA5 + MA5>MA10 → 应筛出
  '600001': { name: '测试股A', closes: [10, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 10.9, 11.0, 11.2, 11.4, 11.6] },
  // 600002：最后3天 10.2→10.3→10.2，非连续上涨 → 不应筛出
  '600002': { name: '测试股B', closes: [10, 10, 10, 10, 10, 10, 10, 10, 10.1, 10.2, 10.3, 10.2] },
  // 600003：中间停牌多日，有效交易日不足 10 → 不应筛出
  '600003': { name: '测试股C', closes: [10, 10.2, 10.4, 10.6, 10.8, null, null, null, null, null, 11.4, 11.6] },
  // 600004：连续3日上涨但 MA5<=MA10（均线未多头）→ 不应筛出
  '600004': { name: '测试股D', closes: [20, 19, 18, 17, 16, 15, 14, 13, 12, 11.5, 12, 12.5] },
};

(async () => {
  priceHistory.setLogger({ info: () => {}, warn: () => {}, error: () => {} });

  // 1. 写入 12 天快照
  for (let i = 0; i < DATES.length; i++) {
    const date = DATES[i];
    const rows = Object.entries(STOCKS).map(([code, s]) => ({
      code,
      name: s.name,
      price: s.closes[i], // null 表示停牌
      amount: s.closes[i] == null ? 0 : 1e8,
      market: code.startsWith('6') ? 0 : 1,
    }));
    priceHistory.saveDaySnapshot(date, rows);
  }

  // 2. 验证读取
  const day = priceHistory.loadDay(DATES[0]);
  console.log('读回第1天行数:', day ? day.length : 'null');

  // 3. 验证个股序列
  const seq = priceHistory.getStockSeries('600003', 12);
  console.log('600003 有效收盘天数:', seq.length, '(预期 7，停牌日被跳过)');

  // 4. 筛选
  const recent = priceHistory.loadRecentDays(12);
  const results = screener.runScreener(recent);
  console.log('筛选结果数:', results.length, '(预期 1)');
  console.log('命中明细:', JSON.stringify(results, null, 2));
  console.log('有效交易日:', screener.readyDays(recent));

  const ok =
    day && day.length === 4 &&
    seq.length === 7 &&
    results.length === 1 &&
    results[0].code === '600001';

  // 5. 清理测试文件（仅删除本脚本用到的日期，保留真实数据）
  let removed = 0;
  for (const date of DATES) {
    const f = path.join(priceHistory.PRICE_DIR, `${date}.json`);
    if (fs.existsSync(f)) { fs.unlinkSync(f); removed++; }
  }
  const remain = fs.readdirSync(priceHistory.PRICE_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;
  console.log(`已清理测试文件 ${removed} 个，剩余真实快照 ${remain} 个`);

  if (ok && removed === DATES.length) {
    console.log('PRICE_SCREENER_TEST_PASS');
  } else {
    console.error('PRICE_SCREENER_TEST_FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error('脚本异常', e);
  process.exit(1);
});
