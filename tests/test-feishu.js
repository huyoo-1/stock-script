// 飞书凭证自检：加载 config.json 构造 client，发测试卡片。
// 早发现 appId/appSecret 错误、未入群(230002)、im:message 权限缺失。
// 用法: npm run test:feishu
const path = require('path');
const { loadConfig } = require('../lib/config');
const { createLogger } = require('../lib/log');
const { createFeishuClient } = require('../lib/feishu');

async function main() {
  const config = loadConfig(path.join(__dirname, '..', 'config.json'));
  const logger = createLogger(path.join(__dirname, '..', 'logs'));
  const feishu = createFeishuClient(config, logger);
  logger.info('发送飞书测试消息...');
  const ok = await feishu.sendTest();
  if (ok) {
    logger.info('✅ 飞书测试成功，凭证与入群配置正常');
    process.exit(0);
  } else {
    logger.error('❌ 飞书测试失败，详见日志（常见：appId/appSecret 错误、未入群 code=230002、缺 im:message 权限）');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});
