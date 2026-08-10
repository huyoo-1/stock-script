// 技术筛选单测：ma / consecutiveUp / runScreener
// 用法: node --test tests/screener.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ma, consecutiveUp, runScreener, readyDays, MA10_DAYS } = require('../lib/screener');

// 造 daysData：每只股票的收盘价序列
function makeDaysData(stocks, dates) {
  return dates.map((date) => ({
    date,
    rows: Object.entries(stocks).map(([code, s]) => ({
      code,
      name: s.name,
      close: s.closes.shift(),
    })),
  }));
}

const DATES = Array.from({ length: 12 }, (_, i) => `2025-01-${String(i + 2).padStart(2, '0')}`);

describe('ma', () => {
  it('样本足返回均值', () => {
    assert.equal(ma([10, 20, 30], 3), 20);
  });
  it('样本不足返回 null', () => {
    assert.equal(ma([10, 20], 3), null);
    assert.equal(ma(null, 3), null);
  });
  it('取最后 n 个', () => {
    assert.equal(ma([1, 2, 3, 4, 5], 3), 4); // (3+4+5)/3
  });
});

describe('consecutiveUp', () => {
  it('连续上涨', () => assert.equal(consecutiveUp([10, 11, 12], 3), true));
  it('非连续', () => assert.equal(consecutiveUp([10, 12, 11], 3), false));
  it('样本不足', () => assert.equal(consecutiveUp([10, 11], 3), false));
  it('持平不算上涨', () => assert.equal(consecutiveUp([10, 10, 11], 3), false));
});

describe('runScreener', () => {
  it('筛出符合条件的股票', () => {
    const stocks = {
      // 连续3日涨 + 价>=MA5 + MA5>MA10 → 应筛出
      '600001': { name: 'A', closes: [10, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 10.9, 11.0, 11.2, 11.4, 11.6] },
      // 最后3天非连续上涨 → 不筛出
      '600002': { name: 'B', closes: [10, 10, 10, 10, 10, 10, 10, 10, 10.1, 10.2, 10.3, 10.2] },
      // MA5<=MA10（均线未多头）→ 不筛出
      '600003': { name: 'C', closes: [20, 19, 18, 17, 16, 15, 14, 13, 12, 11.5, 12, 12.5] },
    };
    const days = makeDaysData(stocks, DATES);
    const results = runScreener(days, { upDays: 3 });
    assert.equal(results.length, 1);
    assert.equal(results[0].code, '600001');
    assert.ok(results[0].ma5 > results[0].ma10, 'MA5 应大于 MA10');
  });

  it('MA10 样本不足跳过', () => {
    const stocks = {
      '600004': { name: 'D', closes: [10, 11, 12, 13, 14, 15, 16, 17, 18] }, // 只9天
    };
    const dates = DATES.slice(0, 9);
    const days = makeDaysData(stocks, dates);
    const results = runScreener(days, { upDays: 3 });
    assert.equal(results.length, 0); // 不足 MA10_DAYS
  });

  it('结果按收盘价降序', () => {
    const stocks = {
      '600001': { name: 'A', closes: [10, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 10.9, 11.0, 11.2, 11.4, 11.6] },
      '600005': { name: 'E', closes: [20, 20.2, 20.3, 20.4, 20.5, 20.7, 20.8, 20.9, 21.0, 21.2, 21.4, 21.6] },
    };
    const days = makeDaysData(stocks, DATES);
    const results = runScreener(days, { upDays: 3 });
    assert.equal(results[0].code, '600005'); // 21.6 > 11.6
    assert.equal(results[1].code, '600001');
  });
});

describe('readyDays', () => {
  it('统计有效交易日', () => {
    const days = [
      { date: '2025-01-02', rows: [{ code: '1', close: 10 }] },
      { date: '2025-01-03', rows: [] }, // 无数据
      { date: '2025-01-04', rows: [{ code: '1', close: 11 }] },
    ];
    assert.equal(readyDays(days), 2);
  });
});
