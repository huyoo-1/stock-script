// 市场广度算法单测：涨跌停判定 + 广度统计 + 活跃度分级
// 用法: node --test tests/breadth.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isBseCode, isKcCyStock, isStStock, limitRatio,
  limitUpPrice, limitDownPrice, computeBreadth, activityTier,
} = require('../lib/breadth');

describe('isBseCode', () => {
  it('92/43/81 开头为北交所', () => {
    assert.equal(isBseCode('920001'), true);
    assert.equal(isBseCode('430001'), true);
    assert.equal(isBseCode('810001'), true);
  });
  it('900 开头不算', () => assert.equal(isBseCode('900001'), false));
  it('普通主板/创业/科创不是北交所', () => {
    assert.equal(isBseCode('000001'), false);
    assert.equal(isBseCode('300001'), false);
    assert.equal(isBseCode('688001'), false);
  });
  it('非法格式', () => {
    assert.equal(isBseCode('123'), false);
    assert.equal(isBseCode(null), false);
  });
});

describe('limitRatio', () => {
  it('北交所 30%', () => assert.equal(limitRatio('920001', 'X'), 0.30));
  it('科创/创业 20%', () => {
    assert.equal(limitRatio('688001', 'X'), 0.20);
    assert.equal(limitRatio('300001', 'X'), 0.20);
  });
  it('ST 5%', () => assert.equal(limitRatio('000001', 'ST 江泉'), 0.05));
  it('主板 10%', () => assert.equal(limitRatio('000001', '贵州茅台'), 0.10));
});

describe('limitUpPrice / limitDownPrice', () => {
  it('主板 10 元 → 涨停 11.00 / 跌停 9.00', () => {
    assert.equal(limitUpPrice(10, 0.10), 11.00);
    assert.equal(limitDownPrice(10, 0.10), 9.00);
  });
  it('四舍五入：9.99 主板 → 涨停 10.99', () => {
    assert.equal(limitUpPrice(9.99, 0.10), 10.99);
  });
});

describe('computeBreadth', () => {
  it('统计涨/跌/平/涨跌停 + 成交额元→亿', () => {
    const rows = [
      { code: '000001', name: 'A', price: 11.00, preClose: 10, amount: 5e8 }, // 涨停
      { code: '000002', name: 'B', price: 9.00, preClose: 10, amount: 3e8 },  // 跌停
      { code: '000003', name: 'C', price: 10, preClose: 10, amount: 2e8 },    // 平
      { code: '000004', name: 'D', price: 10.5, preClose: 10, amount: 1e8 },   // 涨未停
    ];
    const b = computeBreadth(rows);
    assert.equal(b.up, 2);      // A + D
    assert.equal(b.down, 1);    // B
    assert.equal(b.flat, 1);     // C
    assert.equal(b.limitUp, 1);  // A
    assert.equal(b.limitDown, 1);// B
    assert.equal(b.totalAmountYi, 11); // 5+3+2+1=11 亿
  });

  it('停牌过滤（price/preClose null 或 amount 0）', () => {
    const rows = [
      { code: '000001', name: 'A', price: null, preClose: 10, amount: 1e8 },
      { code: '000002', name: 'B', price: 10, preClose: null, amount: 1e8 },
      { code: '000003', name: 'C', price: 10, preClose: 10, amount: 0 },
    ];
    const b = computeBreadth(rows);
    assert.equal(b.up, 0);
    assert.equal(b.totalAmountYi, 0);
  });
});

describe('activityTier', () => {
  it('≥15000 高活跃', () => assert.equal(activityTier(15000), '高活跃'));
  it('≥9000 中等活跃', () => assert.equal(activityTier(9000), '中等活跃'));
  it('<9000 缩量观望', () => assert.equal(activityTier(8000), '缩量观望'));
});
