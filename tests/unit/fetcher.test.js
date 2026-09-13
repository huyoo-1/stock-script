// 数据源策略模式单测：CircuitBreaker + FetcherManager + BaseFetcher。
// 用法: node --test tests/unit/fetcher.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BaseFetcher } = require('../../lib/data/base');
const { CircuitBreaker } = require('../../lib/data/breakers');
const { FetcherManager } = require('../../lib/data/manager');

// 伪造 http 客户端
function fakeHttp() {
  return { get() {} };
}

// 伪造 logger
const silentLogger = { info() {}, warn() {}, error() {} };

describe('BaseFetcher', () => {
  it('默认名称和优先级', () => {
    const f = new BaseFetcher();
    assert.equal(f.name, 'base');
    assert.equal(f.priority, 99);
  });

  it('fetch 抛出子类未实现错误', async () => {
    const f = new BaseFetcher();
    await assert.rejects(() => f.fetch(fakeHttp(), {}), /必须实现 fetch/);
  });

  it('isAvailable 默认返回 true', () => {
    const f = new BaseFetcher();
    assert.equal(f.isAvailable(), true);
  });
});

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
  });

  it('初始状态可用', () => {
    assert.equal(cb.isAvailable('test'), true);
  });

  it('未达到阈值不熔断', () => {
    cb.recordFailure('test', new Error('fail'));
    cb.recordFailure('test', new Error('fail'));
    assert.equal(cb.isAvailable('test'), true);
  });

  it('达到阈值后熔断', () => {
    cb.recordFailure('test', new Error('fail'));
    cb.recordFailure('test', new Error('fail'));
    cb.recordFailure('test', new Error('fail'));
    assert.equal(cb.isAvailable('test'), false);
  });

  it('501 即时熔断', () => {
    const err = new Error('WAF');
    err.status = 501;
    cb.recordFailure('test', err);
    assert.equal(cb.isAvailable('test'), false);
  });

  it('456 即时熔断', () => {
    const err = new Error('IP ban');
    err.status = 456;
    cb.recordFailure('test', err);
    assert.equal(cb.isAvailable('test'), false);
  });

  it('recordSuccess 重置熔断', () => {
    const err = new Error('WAF');
    err.status = 501;
    cb.recordFailure('test', err);
    assert.equal(cb.isAvailable('test'), false);
    cb.recordSuccess('test');
    assert.equal(cb.isAvailable('test'), true);
  });

  it('冷却后自动恢复', async () => {
    const cb2 = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    cb2.recordFailure('test', new Error('fail'));
    assert.equal(cb2.isAvailable('test'), false);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(cb2.isAvailable('test'), true);
  });

  it('不同 key 独立熔断', () => {
    cb.recordFailure('a', new Error('fail'));
    cb.recordFailure('a', new Error('fail'));
    cb.recordFailure('a', new Error('fail'));
    assert.equal(cb.isAvailable('a'), false);
    assert.equal(cb.isAvailable('b'), true);
  });

  it('reset 清除所有状态', () => {
    cb.recordFailure('a', new Error('fail'));
    cb.recordFailure('a', new Error('fail'));
    cb.recordFailure('a', new Error('fail'));
    cb.reset();
    assert.equal(cb.isAvailable('a'), true);
  });
});

describe('FetcherManager', () => {
  it('按优先级依次尝试，首个成功即返回', async () => {
    const cb = new CircuitBreaker();
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    let callOrder = [];
    class F1 extends BaseFetcher { name = 'f1'; priority = 0; capability = 'test'; async fetch() { callOrder.push('f1'); throw new Error('fail'); } }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; capability = 'test'; async fetch() { callOrder.push('f2'); return 'ok'; } }
    class F3 extends BaseFetcher { name = 'f3'; priority = 2; capability = 'test'; async fetch() { callOrder.push('f3'); return 'never'; } }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());
    mgr.addFetcher(new F3());

    const { result, source } = await mgr.execute(fakeHttp(), {}, { capability: 'test' });
    assert.equal(result, 'ok');
    assert.equal(source, 'f2');
    assert.deepEqual(callOrder, ['f1', 'f2']);
  });

  it('全部失败返回 { result:null, source:\'none\' }', async () => {
    const cb = new CircuitBreaker();
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    class F1 extends BaseFetcher { name = 'f1'; priority = 0; capability = 'test'; async fetch() { throw new Error('fail'); } }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; capability = 'test'; async fetch() { throw new Error('fail'); } }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());

    const { result, source, error } = await mgr.execute(fakeHttp(), {}, { capability: 'test' });
    assert.equal(result, null);
    assert.equal(source, 'none');
    assert.ok(error.includes('f1'));
    assert.ok(error.includes('f2'));
  });

  it('跳过熔断中的 fetcher', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10000 });
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    // 先让 F1 失败一次，触发熔断
    class F1 extends BaseFetcher { name = 'f1'; priority = 0; capability = 'test'; async fetch() { throw new Error('fail'); } }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; capability = 'test'; async fetch() { return 'ok'; } }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());

    const { result, source } = await mgr.execute(fakeHttp(), {}, { capability: 'test' });
    assert.equal(result, 'ok');
    assert.equal(source, 'f2');
  });

  it('validate 校验失败视为失败', async () => {
    const cb = new CircuitBreaker();
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    class F1 extends BaseFetcher { name = 'f1'; priority = 0; capability = 'test'; async fetch() { return { n: 5 }; } }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; capability = 'test'; async fetch() { return { n: 20 }; } }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());

    const { result, source } = await mgr.execute(fakeHttp(), {}, {
      capability: 'test',
      validate: (r) => r.n >= 10,
    });
    assert.equal(result.n, 20);
    assert.equal(source, 'f2');
  });

  it('addFetcher 自动按优先级排序', () => {
    const mgr = new FetcherManager({ logger: silentLogger });
    class F1 extends BaseFetcher { name = 'f1'; priority = 3; }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; }
    class F3 extends BaseFetcher { name = 'f3'; priority = 2; }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());
    mgr.addFetcher(new F3());

    assert.equal(mgr._fetchers[0].name, 'f2');
    assert.equal(mgr._fetchers[1].name, 'f3');
    assert.equal(mgr._fetchers[2].name, 'f1');
  });

  it('marketSupport 过滤不匹配的市场', async () => {
    const cb = new CircuitBreaker();
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    class F1 extends BaseFetcher { name = 'f1'; priority = 0; capability = 'test'; marketSupport = new Set(['cn']); async fetch() { return 'cn'; } }
    class F2 extends BaseFetcher { name = 'f2'; priority = 1; capability = 'test'; marketSupport = new Set(['us']); async fetch() { return 'us'; } }

    mgr.addFetcher(new F1());
    mgr.addFetcher(new F2());

    const { result } = await mgr.execute(fakeHttp(), { market: 'us' }, { capability: 'test' });
    assert.equal(result, 'us');
  });

  it('capability 路由：只试匹配类别的 fetcher，不碰其他类别', async () => {
    const cb = new CircuitBreaker();
    const mgr = new FetcherManager({ circuitBreaker: cb, logger: silentLogger });

    const called = [];
    // allA 类别的 fetcher，不该被 indexQuote 调用碰到
    class AllA extends BaseFetcher { name = 'allA'; priority = 0; capability = 'allA'; async fetch() { called.push('allA'); return []; } }
    // indexQuote 类别的两个 fetcher
    class Idx1 extends BaseFetcher { name = 'idx1'; priority = 0; capability = 'indexQuote'; async fetch() { called.push('idx1'); throw new Error('fail'); } }
    class Idx2 extends BaseFetcher { name = 'idx2'; priority = 1; capability = 'indexQuote'; async fetch() { called.push('idx2'); return 'ok'; } }

    mgr.addFetcher(new AllA());
    mgr.addFetcher(new Idx1());
    mgr.addFetcher(new Idx2());

    const { result, source } = await mgr.execute(fakeHttp(), {}, { capability: 'indexQuote' });
    assert.equal(result, 'ok');
    assert.equal(source, 'idx2');
    // allA fetcher 不应被调用
    assert.deepEqual(called, ['idx1', 'idx2']);
  });
});