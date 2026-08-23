// 日 K 数据源单测：腾讯/新浪解析 + MA20 provider（fake http，不联网）。
// 用法: node --test tests/kline.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  toSecid, meanOfLast, parseTencentKline, parseSinaKline,
  createMa20Provider, clearKlineCache,
} = require('../lib/kline');

beforeEach(() => clearKlineCache());

function tencentPayload(secid, count) {
  const day = [];
  for (let i = 0; i < count; i++) {
    const close = i + 1;
    day.push([
      `2026-01-${String(i + 1).padStart(2, '0')}`,
      String(close - 0.1), String(close), String(close + 0.1), String(close - 0.2), '1000',
    ]);
  }
  return { code: 0, msg: '', data: { [secid]: { day } } };
}

describe('toSecid', () => {
  it('按交易所加前缀', () => {
    assert.equal(toSecid('600000'), 'sh600000');
    assert.equal(toSecid('510300'), 'sh510300');
    assert.equal(toSecid('900901'), 'sh900901');
    assert.equal(toSecid('000001'), 'sz000001');
    assert.equal(toSecid('300750'), 'sz300750');
    assert.equal(toSecid('430047'), 'bj430047');
  });
});

describe('meanOfLast', () => {
  it('取最后 n 个均值', () => {
    const values = Array.from({ length: 25 }, (_, i) => i + 1);
    assert.equal(meanOfLast(values, 20), 15.5); // 6..25
  });
  it('样本不足返回 null', () => {
    assert.equal(meanOfLast([1, 2, 3], 20), null);
    assert.equal(meanOfLast(null, 20), null);
  });
});

describe('parseTencentKline', () => {
  it('解析 day 数组', () => {
    const rows = parseTencentKline(tencentPayload('sh600000', 25), 'sh600000');
    assert.equal(rows.length, 25);
    assert.equal(rows[0].date, '2026-01-01');
    assert.equal(rows[0].close, 1);
    assert.equal(rows[2].high, 3.1);
  });
  it('无数据返回空数组', () => {
    assert.deepEqual(parseTencentKline({ code: 0, data: { sh600000: {} } }, 'sh600000'), []);
  });
});

describe('parseSinaKline', () => {
  it('解析 var _data= JSONP', () => {
    const text = 'var _data=([{"day":"2026-01-01","open":"1","high":"2","low":"0.5","close":"1.5","volume":"1000"}]);';
    const rows = parseSinaKline(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].close, 1.5);
    assert.equal(rows[0].volume, 1000);
  });
  it('null/非法输入返回空数组', () => {
    assert.deepEqual(parseSinaKline('var _data=null;'), []);
    assert.deepEqual(parseSinaKline(null), []);
    assert.deepEqual(parseSinaKline('not json'), []);
  });
});

describe('createMa20Provider', () => {
  it('腾讯日K算出 MA20 并缓存', async () => {
    let calls = 0;
    const http = {
      get: async () => {
        calls++;
        return tencentPayload('sh600000', 25);
      },
    };
    const provider = createMa20Provider({
      http,
      config: { screener: { ma20Source: 'tencent', ma20Days: 20, cacheTtlMs: 60000 } },
    });
    assert.equal(provider.enabled, true);
    assert.equal(await provider.fetch('600000'), 15.5);
    assert.equal(await provider.fetch('600000'), 15.5);
    assert.equal(calls, 1); // 第二次命中缓存
  });

  it('日K样本不足返回 null', async () => {
    const http = { get: async () => tencentPayload('sh600000', 10) };
    const provider = createMa20Provider({
      http,
      config: { screener: { ma20Source: 'tencent', ma20Days: 20 } },
    });
    assert.equal(await provider.fetch('600000'), null);
  });

  it('off 关闭精筛', () => {
    const provider = createMa20Provider({ config: { screener: { ma20Source: 'off' } } });
    assert.equal(provider.enabled, false);
  });
});
