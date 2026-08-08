// tests/test_fetch_snapshot.js
// 验证 fetchMarketSnapshot：全 A 抓取 + 进度打印 + 数据质量（广度/拥挤度/成分股派生）。
// 用法：
//   node tests/test_fetch_snapshot.js                # 全量（最多 80 页）
//   node tests/test_fetch_snapshot.js --maxPages 5   # 小流量（仅前 5 页）
//   node tests/test_fetch_snapshot.js --em           # 单独验证东财大包
const path = require('path');
const { createLogger } = require('../lib/log');
const { createHttpClient } = require('../lib/http');
const em = require('../lib/emData');
const breadth = require('../lib/breadth');
const crowd = require('../lib/crowd');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

(async () => {
  const maxPages = parseInt(arg('--maxPages') || '0', 10);
  const testEm = process.argv.includes('--em');
  const logger = createLogger(path.join(__dirname, '..', 'logs'));
  const http = createHttpClient({ maxRetries: 2, logger });

  // 可选：先单独验证东财大包（确认兜底路径可用）
  if (testEm) {
    console.log('=== 测试东财大包 (fetchAllASharesEm) ===');
    const t = Date.now();
    try {
      const rows = await em.fetchAllASharesEm(http);
      console.log(`东财大包成功: ${rows.length} 只, 耗时 ${((Date.now() - t) / 1000).toFixed(1)}s`);
      const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
      console.log(`两市成交额合计: ${(total / 1e8).toFixed(2)} 亿元`);
    } catch (e) {
      console.log(`东财大包失败: ${e.message}`);
    }
    return;
  }

  console.log(`开始抓取市场快照（新浪优先，东财兜底${maxPages ? `，最大 ${maxPages} 页` : ''}）...`);
  const t0 = Date.now();
  const snap = await em.fetchMarketSnapshot(http, {
    logger,
    maxPages: maxPages || undefined,
    onProgress: ({ stage, page, got, node }) => {
      const label = stage === 'allA' ? '全A股' : stage === 'bShare' ? `B股(${node})` : stage;
      console.log(`[抓取] ${label}: 第 ${page} 页, 已获取 ${got} 只`);
    },
  });
  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s, 数据源: ${snap.allSource}`);

  if (snap.error) {
    console.error(`抓取失败: ${snap.error}`);
    process.exit(1);
  }

  console.log(`全A: ${snap.allShares.length} 只`);
  console.log(`上证成分股(派生): ${snap.shConst.length} 只`);
  console.log(`创业板成分股(派生): ${snap.cyConst.length} 只`);
  console.log(`B股: ${snap.bShares.length} 只`);

  const b = breadth.computeBreadth(snap.allShares);
  console.log(`广度: 涨/跌/平=${b.up}/${b.down}/${b.flat} 涨停/跌停=${b.limitUp}/${b.limitDown} 成交额=${b.totalAmountYi}亿`);

  const c1 = crowd.computeCrowding(snap.allShares, snap.shConst, { normal: 40, warning: 50 }, (r) => r.market === 0);
  const c2 = crowd.computeCrowding(snap.allShares, snap.cyConst, { normal: 40, warning: 50 }, (r) => r.code.startsWith('30'));
  console.log(`上证拥挤度: ${c1.crowding}% (level=${c1.level}, 分母=${(c1.denominator / 1e8).toFixed(0)}亿, topCount=${c1.topCount})`);
  console.log(`创业板拥挤度: ${c2.crowding}% (level=${c2.level}, 分母=${(c2.denominator / 1e8).toFixed(0)}亿, topCount=${c2.topCount})`);
})().catch((e) => {
  console.error('脚本异常', e);
  process.exit(1);
});
