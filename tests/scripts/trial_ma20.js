// tests/scripts/trial_ma20.js
// 用 data/price_history 真实数据试跑 MA20 二次精筛：
// 本地 10 日粗筛 → 数据源日 K（走 FetcherManager）→ 输出多头趋势命中明细。
// 用法: node tests/scripts/trial_ma20.js
const path = require('path');
const { loadConfig } = require('../../lib/core/config');
const { createHttpClient } = require('../../lib/core/http');
const { CircuitBreaker } = require('../../lib/data/breakers');
const { FetcherManager } = require('../../lib/data/manager');
const { TencentKlineFetcher, SinaKlineFetcher } = require('../../lib/data/kline');
const { createMa20Provider } = require('../../lib/kline');
const priceHistory = require('../../lib/store/priceHistory');
const screener = require('../../lib/algo/screener');

const logger = {
  info() {},
  warn(...args) { console.log('[warn]', ...args); },
  error(...args) { console.error('[error]', ...args); },
};

async function main() {
  const root = path.join(__dirname, '..', '..');
  const config = loadConfig(path.join(root, 'config.json'));
  const http = createHttpClient({
    maxRetries: config.maxRetries,
    proxy: config.proxy,
    nid18Enabled: config.nid18Enabled,
    logger,
  });
  const cb = new CircuitBreaker();
  const fetcherMgr = new FetcherManager({ circuitBreaker: cb, logger });
  fetcherMgr.addFetcher(new TencentKlineFetcher());
  fetcherMgr.addFetcher(new SinaKlineFetcher());

  const recent = priceHistory.loadRecentDays(screener.MA10_DAYS);
  const candidates = screener.runScreener(recent);
  const ready = screener.readyDays(recent);
  console.log(`数据：${ready}/${screener.MA10_DAYS} 个交易日，本地粗筛 ${candidates.length} 只`);

  // 1. 探针：前 5 只候选直连日 K，确认数据源可用性与返回行数
  console.log('\n== 数据源探针（前 5 只候选）==');
  for (const it of candidates.slice(0, 5)) {
    const t = Date.now();
    try {
      const { result, source } = await fetcherMgr.execute(http, { code: it.code, days: 20 }, {
        capability: 'kline',
        validate: (rows) => Array.isArray(rows) && rows.length >= 20,
      });
      const rows = result || [];
      console.log(`${it.code} ${it.name}: source=${source} rows=${rows.length} first=${rows[0] && rows[0].date} last=${rows[rows.length - 1] && rows[rows.length - 1].date} ${Date.now() - t}ms`);
    } catch (e) {
      console.log(`${it.code} ${it.name}: FAIL ${e.message}`);
    }
  }

  // 2. 全量二次精筛
  const provider = createMa20Provider({ http, config, logger, fetcherMgr });
  if (!provider.enabled) {
    console.log('\nMA20 精筛未启用（screener.ma20Source=off）');
    return;
  }
  console.log(`\nMA20 数据源：${provider.source}（并发 ${provider.concurrency}，缓存 ${provider.days} 日）`);
  const t0 = Date.now();
  const refined = await screener.applyMa20Filter(candidates, provider.fetch, {
    concurrency: provider.concurrency,
    logger,
  });
  const cost = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`二次精筛：命中 ${refined.items.length} 只，缺失 ${refined.missing.length} 只，耗时 ${cost}s`);

  console.log('\n命中明细（按收盘价降序）：');
  for (const it of refined.items) {
    console.log(`${it.code} ${it.name} close=${it.close} ma5=${it.ma5} ma10=${it.ma10} ma20=${it.ma20}`);
  }

  if (refined.missing.length > 0) {
    const sample = refined.missing.slice(0, 10);
    console.log(`\n缺失示例（前 ${sample.length} 只，共 ${refined.missing.length} 只）：`);
    for (const it of sample) {
      console.log(`${it.code} ${it.name} ma10=${it.ma10}`);
    }
  }
}

main().catch((e) => {
  console.error('试跑失败:', e);
  process.exit(1);
});
