const path = require('path');
const { createLogger } = require('../lib/log');
const { createHttpClient } = require('../lib/http');
const em = require('../lib/emData');
const breadth = require('../lib/breadth');

async function fetchAllASharesSinaOnly(http) {
  const SINA_BULK_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
  const SINA_REFERER = 'https://finance.sina.com.cn/';
  function num(v) {
    if (v === null || v === undefined || v === '-' || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const all = [];
  const pageSize = 80;
  for (let page = 1; page <= 100; page++) {
    const rows = await http.get(SINA_BULK_URL, {
      params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node: 'hs_a', symbol: '', _s_r_a: 'init' },
      headers: { Referer: SINA_REFERER },
      source: `allA:sina:p${page}`,
    });
    console.log(`page ${page}:`, Array.isArray(rows) ? rows.length : typeof rows, rows && rows[0] ? rows[0].code : '');
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      all.push({
        code: String(r.code),
        name: r.name,
        market: r.symbol && r.symbol.startsWith('sh') ? 0 : 1,
        price: num(r.trade),
        preClose: num(r.settlement),
        amount: num(r.amount) || 0,
        chgPct: num(r.changepercent),
      });
    }
    if (rows.length < pageSize) break;
  }
  return all;
}

(async () => {
  const logger = createLogger(path.join(__dirname, '..', 'logs'));
  const http = createHttpClient({ maxRetries: 3, logger });
  const all = await fetchAllASharesSinaOnly(http);
  const b = breadth.computeBreadth(all);
  console.log('A股数量:', all.length);
  console.log('涨跌平:', b.up, b.down, b.flat);
  console.log('涨停/跌停:', b.limitUp, b.limitDown);
  console.log('两市成交额（亿元）:', b.totalAmountYi);
})();
