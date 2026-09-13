// 入口：bootstrap + 进程生命周期 + 调度启动。
const path = require('path');
const { loadConfig } = require('./lib/core/config');
const { createLogger } = require('./lib/core/log');
const { createHttpClient } = require('./lib/core/http');
const { createFeishuClient } = require('./lib/view/feishu');
const { createScheduler } = require('./lib/core/scheduler');
const { runIntraday, runClose } = require('./lib/runner');
const { createWebServer } = require('./lib/view/web');
const history = require('./lib/store/history');
const priceHistory = require('./lib/store/priceHistory');
const goldHistory = require('./lib/store/goldHistory');
const watchlist = require('./lib/store/watchlist');
const screener = require('./lib/algo/screener');
const { createMa20Provider } = require('./lib/kline');

// 数据源策略模式
const { CircuitBreaker } = require('./lib/data/breakers');
const { FetcherManager } = require('./lib/data/manager');
const { SinaAllAFetcher, EmAllAFetcher } = require('./lib/data/allA');
const { SinaIndexFetcher, EmIndexFetcher, SinaEtfFetcher, EmEtfFetcher } = require('./lib/data/indexQuote');
const { EmMarginFetcher, ExchangeMarginFetcher } = require('./lib/data/margin');
const { TencentKlineFetcher, SinaKlineFetcher } = require('./lib/data/kline');
const { SinaGoldPriceFetcher } = require('./lib/data/goldPrice');

function createFetcherManager({ config, logger }) {
  const cb = new CircuitBreaker({
    failureThreshold: (config.dataSources && config.dataSources.circuitBreaker && config.dataSources.circuitBreaker.failureThreshold) || 3,
    cooldownMs: (config.dataSources && config.dataSources.circuitBreaker && config.dataSources.circuitBreaker.cooldownMs) || 300000,
  });
  const mgr = new FetcherManager({ circuitBreaker: cb, logger });

  // 全A行情
  mgr.addFetcher(new SinaAllAFetcher());
  mgr.addFetcher(new EmAllAFetcher());

  // 指数行情
  mgr.addFetcher(new SinaIndexFetcher());
  mgr.addFetcher(new EmIndexFetcher());

  // ETF行情
  mgr.addFetcher(new SinaEtfFetcher());
  mgr.addFetcher(new EmEtfFetcher());

  // 融资融券
  mgr.addFetcher(new EmMarginFetcher());
  mgr.addFetcher(new ExchangeMarginFetcher());

  // 日K线（MA20 精筛用）
  mgr.addFetcher(new TencentKlineFetcher());
  mgr.addFetcher(new SinaKlineFetcher());

  // 黄金金价（伦敦金现货）
  mgr.addFetcher(new SinaGoldPriceFetcher());

  return mgr;
}

async function main() {
  const once = process.argv.includes('--once');
  const config = loadConfig(path.join(__dirname, 'config.json'));
  const logger = createLogger(path.resolve(__dirname, config.logDir || 'logs'), { consoleLevel: config.logConsoleLevel || 'ERROR' });
  logger.info('监控服务启动中...');

  const http = createHttpClient({
    maxRetries: config.maxRetries,
    proxy: config.proxy,
    nid18Enabled: config.nid18Enabled,
    logger,
  });
  const feishu = createFeishuClient(config, logger);
  const fetcherMgr = createFetcherManager({ config, logger });
  logger.info('数据源策略管理器已初始化');
  const ma20Provider = createMa20Provider({ http, config, logger, fetcherMgr });

  // 注入配置与日志：让 historyStorage.dir/backupDir 配置真正生效，
  // 并让 history/priceHistory 在 runIntraday(--once 首条)也能输出内部告警
  history.setConfig(config);
  history.setLogger(logger);
  priceHistory.setLogger(logger);
  goldHistory.setLogger(logger);
  watchlist.setLogger(logger);

  // 启动自检：发测试消息，早发现凭证/入群问题
  if (!once) {
    logger.info('发送飞书测试消息...');
    await feishu.sendTest().catch((e) => logger.error('飞书测试失败', e));
  }

  // 盘中快照内存缓存：Map<date, Map<HH:MM, snapshot>>
  const intradayCache = new Map();

  // --once：跑一次盘中快照后退出（调试用）
  if (once) {
    const time = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    await runIntraday({ config, http, fetcherMgr, feishu, logger, intradayCache, time });
    logger.info('--once 模式完成，退出');
    return;
  }

  const scheduler = createScheduler({
    config, logger,
    onIntraday: (time) => runIntraday({ config, http, fetcherMgr, feishu, logger, intradayCache, time }),
    onClose: () => runClose({ config, http, fetcherMgr, feishu, logger, intradayCache, ma20Provider }),
  });
  scheduler.start();

  // Web 面板（监听地址由 config.web.host 决定，默认 127.0.0.1）
  if (config.web && config.web.enabled) {
    const web = createWebServer({
      config, logger, history, priceHistory, screener, ma20: ma20Provider,
      watchlist, goldHistory, configPath: path.join(__dirname, 'config.json'),
      runClose: () => runClose({ config, http, fetcherMgr, feishu, logger, intradayCache, ma20Provider }),
    });
    const host = config.web.host || '127.0.0.1';
    web.listen(config.web.port || 8787, host, () => {
      logger.info(`Web 面板已启动：http://${host}:${config.web.port || 8787}`);
    });
  }

  // 优雅关闭
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，停止中...`);
    scheduler.stop();
    setTimeout(() => process.exit(0), 2000);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 兜底：单次异常不退出（设计 §11.5），由外层 nssm 拉起
  process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', err));

  logger.info('监控服务已启动，等待调度触发');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
