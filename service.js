// 入口：bootstrap + 进程生命周期 + 调度启动。
const path = require('path');
const { loadConfig } = require('./lib/config');
const { createLogger } = require('./lib/log');
const { createHttpClient } = require('./lib/http');
const { createFeishuClient } = require('./lib/feishu');
const { createScheduler } = require('./lib/scheduler');
const { runIntraday, runClose } = require('./lib/runner');
const { createWebServer } = require('./lib/web');
const history = require('./lib/history');
const priceHistory = require('./lib/priceHistory');
const screener = require('./lib/screener');

async function main() {
  const once = process.argv.includes('--once');
  const config = loadConfig(path.join(__dirname, 'config.json'));
  const logger = createLogger(path.join(__dirname, 'logs'));
  logger.info('监控服务启动中...');

  const http = createHttpClient({
    maxRetries: config.maxRetries,
    proxy: config.proxy,
    nid18Enabled: config.nid18Enabled,
    logger,
  });
  const feishu = createFeishuClient(config, logger);

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
    await runIntraday({ config, http, feishu, logger, intradayCache, time });
    logger.info('--once 模式完成，退出');
    return;
  }

  const scheduler = createScheduler({
    config, logger,
    onIntraday: (time) => runIntraday({ config, http, feishu, logger, intradayCache, time }),
    onClose: () => runClose({ config, http, feishu, logger, intradayCache }),
  });
  scheduler.start();

  // Web 面板（监听地址由 config.web.host 决定，默认 127.0.0.1）
  if (config.web && config.web.enabled) {
    const web = createWebServer({ config, logger, history, priceHistory, screener });
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
