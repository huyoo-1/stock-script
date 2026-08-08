// tests/test_sina_sh_a.js
// 沪市小批量验证脚本：仅拉取新浪 sh_a 节点前 3 页，验证 456 是否缓解。
// 用法：node tests/test_sina_sh_a.js

const { createHttpClient } = require('../lib/http');

const SINA_BULK_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_REFERER = 'https://finance.sina.com.cn/';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchPage(http, page, pageSize) {
  return http.get(SINA_BULK_URL, {
    params: {
      page: String(page),
      num: String(pageSize),
      sort: 'amount',
      asc: '0',
      node: 'sh_a',
      symbol: '',
      _s_r_a: 'init',
    },
    headers: { Referer: SINA_REFERER },
    source: `test:sina:sh_a:p${page}`,
    sina: { minGap: randInt(1500, 3000) },
    timeout: 10000,
  });
}

async function main() {
  const http = createHttpClient({ maxRetries: 2, logger: console });
  const pageSize = 80;
  const totalPages = 3;
  const all = [];
  const codes = [];

  for (let page = 1; page <= totalPages; page++) {
    try {
      const rows = await fetchPage(http, page, pageSize);
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`[p${page}] 无数据，终止`);
        break;
      }
      console.log(`[p${page}] 成功 ${rows.length} 条，首条 ${rows[0].code} ${rows[0].name}`);
      for (const r of rows) {
        all.push(r);
        codes.push(String(r.code));
      }
      if (rows.length < pageSize) break;
      await sleep(randInt(1500, 3000));
    } catch (e) {
      const status = e.response && e.response.status;
      console.error(`[p${page}] 失败 status=${status || 'network'} message=${e.message}`);
      break;
    }
  }

  console.log(`\n总计拉取 ${all.length} 条沪市 A 股`);
  console.log(`代码前 10: ${codes.slice(0, 10).join(', ')}`);
  const hasSh = codes.every((c) => c.startsWith('6') || c.startsWith('68'));
  console.log(`是否全部为沪市代码: ${hasSh ? '是' : '否'}`);
  if (!hasSh) {
    const outsiders = codes.filter((c) => !c.startsWith('6') && !c.startsWith('68'));
    console.log(`异常代码: ${outsiders.slice(0, 5).join(', ')}`);
  }
}

main().catch((e) => {
  console.error('脚本异常', e);
  process.exit(1);
});
