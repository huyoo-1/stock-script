// 拥挤度算法单测：computeCrowding（2026-08-02 新口径）/ levelOf / deltaText
// 用法: node --test tests/crowd.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeCrowding, levelOf, deltaText } = require('../lib/crowd');

const TH = { normal: 40, warning: 50 };

// 造全 A 股：n 只，第 0 只成交额最大
function allShares(n, topAmount = 100, restAmount = 10) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ code: String(600000 + i), name: `股${i}`, market: 0, amount: i === 0 ? topAmount : restAmount });
  }
  return arr;
}

describe('computeCrowding 新口径', () => {
  it('分子=全A前5%中属于该市场的成交额之和，分母=该市场有效成交额之和', () => {
    // 20 只全A：1 只 100，19 只 10。前5%=1只（最大的那只）。
    // 若该只属于该市场 → 分子100，分母290 → 34.48%
    const all = allShares(20);
    const market = all; // 全部属于该市场
    const c = computeCrowding(all, market, TH, (r) => true);
    assert.equal(c.numerator, 100);
    assert.equal(c.denominator, 290);
    assert.equal(c.crowding, 34.48);
  });

  it('前5%中不属于该市场的不计入分子', () => {
    // 20 只全A：最大那只 market=1（不属于上证 market=0）
    const all = allShares(20);
    all[0].market = 1; // 头部股不属于上证
    const shMarket = all.filter((r) => r.market === 0); // 19 只
    const c = computeCrowding(all, shMarket, TH, (r) => r.market === 0);
    assert.equal(c.numerator, 0); // 头部股不属于上证，分子0
    assert.equal(c.crowding, 0);
  });

  it('前5%向上取整：20只取1，21只取2', () => {
    const c20 = computeCrowding(allShares(20), allShares(20), TH, () => true);
    assert.equal(c20.topCount, 1);
    const c21 = computeCrowding(allShares(21), allShares(21), TH, () => true);
    assert.equal(c21.topCount, 2);
  });

  it('停牌(amount=0)过滤', () => {
    const all = [
      { code: '1', name: 'A', market: 0, amount: 100 },
      { code: '2', name: 'B', market: 0, amount: 0 }, // 停牌
    ];
    const c = computeCrowding(all, all, TH, () => true);
    assert.equal(c.validCount, 1);
    assert.equal(c.crowding, 100); // 单只全集中
  });

  it('全停牌返回 null/unknown', () => {
    const c = computeCrowding(
      [{ code: '1', name: 'A', market: 0, amount: 0 }],
      [{ code: '1', name: 'A', amount: 0 }],
      TH, () => true,
    );
    assert.equal(c.crowding, null);
    assert.equal(c.level, 'unknown');
  });

  it('level 由 crowding 映射', () => {
    const c = computeCrowding(allShares(20), allShares(20), TH, () => true); // 34.48 → normal
    assert.equal(c.level, 'normal');
  });
});

describe('levelOf', () => {
  it('< normal → normal', () => assert.equal(levelOf(30, TH), 'normal'));
  it('normal 边界 → watch', () => assert.equal(levelOf(40, TH), 'watch'));
  it('warning 边界 → warning', () => assert.equal(levelOf(50, TH), 'warning'));
  it('null → unknown', () => assert.equal(levelOf(null, TH), 'unknown'));
});

describe('deltaText', () => {
  it('上升', () => assert.equal(deltaText(50, 45), '↑5.00'));
  it('下降', () => assert.equal(deltaText(40, 45), '↓5.00'));
  it('持平', () => assert.equal(deltaText(45, 45), '→0.00'));
  it('缺前值返回 null', () => assert.equal(deltaText(50, null), null));
});
