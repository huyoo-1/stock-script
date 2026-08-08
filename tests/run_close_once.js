// tests/run_close_once.js
// 手动触发一次收盘汇总完整流程（抓取 → 推送 → 历史写入），验证全链路。
// 注意：会真实推送一条飞书消息并写入 data/history/YYYY.json。
// 用法: node tests/run_close_once.js
const path = require('path');
const { loadConfig } = require('../lib/config');
const { createLogger } = require('../lib/log');
const { createHttpClient } = require('../lib/http');
const { createFeishuClient } = require('../lib/feishu');
const { runClose } = require('../lib/runner');

(async () => {
  const root = path.join(__dirname, '..');
  const config = loadConfig(path.join(root, 'config.json'));
  const logger = createLogger(path.join(root, 'logs'));
  const http = createHttpClient({
    maxRetries: config.maxRetries,
    proxy: config.proxy,
    nid18Enabled: config.nid18Enabled,
    logger,
  });
  const feishu = createFeishuClient(config, logger);
  console.log('开始收盘汇总完整流程验证...');
  const t0 = Date.now();
  await runClose({ config, http, feishu, logger, intradayCache: new Map() });
  console.log(`完整流程完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => {
  console.error('完整流程失败:', e);
  process.exit(1);
});
