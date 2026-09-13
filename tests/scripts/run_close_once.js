// tests/scripts/run_close_once.js
// 手动触发一次收盘汇总完整流程（抓取 → 推送 → 历史写入），验证全链路。
// 注意：会真实推送一条飞书消息并写入 data/history/YYYY.json。
// 用法: node tests/scripts/run_close_once.js
const path = require('path');
const { loadConfig } = require('../../lib/core/config');
const { createLogger } = require('../../lib/core/log');
const { createHttpClient } = require('../../lib/core/http');
const { createFeishuClient } = require('../../lib/view/feishu');
const { runClose } = require('../../lib/runner');

// 数据源策略模式
const { CircuitBreaker } = require('../../lib/data/breakers');
const { FetcherManager } = require('../../lib/data/manager');
const { SinaAllAFetcher, EmAllAFetcher } = require('../../lib/data/allA');
const { SinaIndexFetcher, EmIndexFetcher, SinaEtfFetcher, EmEtfFetcher } = require('../../lib/data/indexQuote');
const { EmMarginFetcher, ExchangeMarginFetcher } = require('../../lib/data/margin');
const { TencentKlineFetcher, SinaKlineFetcher } = require('../../lib/data/kline');
const { SinaGoldPriceFetcher } = require('../../lib/data/goldPrice');
const { createMa20Provider } = require('../../lib/kline');

(async () => {
  const root = path.join(__dirname, '..', '..');
  const config = loadConfig(path.join(root, 'config.json'));
  const logger = createLogger(path.join(root, 'logs'));
  const http = createHttpClient({
    maxRetries: config.maxRetries,
    proxy: config.proxy,
    nid18Enabled: config.nid18Enabled,
    logger,
  });
  const feishu = createFeishuClient(config, logger);

  // 创建 FetcherManager
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300000 });
  const fetcherMgr = new FetcherManager({ circuitBreaker: cb, logger });
  fetcherMgr.addFetcher(new SinaAllAFetcher());
  fetcherMgr.addFetcher(new EmAllAFetcher());
  fetcherMgr.addFetcher(new SinaIndexFetcher());
  fetcherMgr.addFetcher(new EmIndexFetcher());
  fetcherMgr.addFetcher(new SinaEtfFetcher());
  fetcherMgr.addFetcher(new EmEtfFetcher());
  fetcherMgr.addFetcher(new EmMarginFetcher());
  fetcherMgr.addFetcher(new ExchangeMarginFetcher());
  fetcherMgr.addFetcher(new TencentKlineFetcher());
  fetcherMgr.addFetcher(new SinaKlineFetcher());
  fetcherMgr.addFetcher(new SinaGoldPriceFetcher());
  console.log('数据源策略管理器已初始化');
  const ma20Provider = createMa20Provider({ http, config, logger, fetcherMgr });

  console.log('开始收盘汇总完整流程验证...');
  const t0 = Date.now();
  await runClose({ config, http, fetcherMgr, feishu, logger, intradayCache: new Map(), ma20Provider });
  console.log(`完整流程完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => {
  console.error('完整流程失败:', e);
  process.exit(1);
});
