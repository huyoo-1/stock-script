// 东方财富数据源字段/常量与纯函数工具。
// 抓取逻辑已迁至 lib/data/ 下的 fetcher（allA/indexQuote/margin/kline），
// 本文件只保留：URL/字段常量、toSecid/num/parseDiffRows/isEmBlocked、deriveConstituents、fetchBShares。
const path = require('path');
const fs = require('fs');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const EM_CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
const EM_STOCK_GET_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

// 新浪备选源（B 股成交额仍走新浪分页）
const SINA_BULK_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_REFERER = 'https://finance.sina.com.cn/';
const SINA_PAGE_DELAY = { min: 1200, max: 2500 }; // 新浪分页翻页间隔

// 东财固定 token + 通用参数（参考 alphasift_service.py:1995-2003）
const COMMON_PARAMS = {
  pn: '1',
  po: '1',
  np: '1',
  ut: 'bd1d9ddb04089700cf9c27f6f7426281',
  fltt: '2',
  invt: '2',
  fid: 'f12',
};

// 字段码：f2=最新价 f3=涨跌幅 f4=涨跌额 f5=成交量 f6=成交额 f8=换手率
// f10=量比 f12=代码 f13=市场(0=SH,1=SZ) f14=名称 f15=最高 f16=最低
// f17=今开 f18=昨收 f20=总市值 f21=流通市值
// f43=最新价 f44=最高 f45=最低 f46=今开 f47=成交量(手) f48=成交额 f57=代码 f58=名称 f60=昨收 f107=市场 f170=涨跌幅
const FIELDS_BREADTH = 'f2,f3,f12,f13,f14,f18,f6'; // 广度：价/涨跌幅/码/市场/名/昨收/成交额
const FIELDS_CROWD = 'f6,f12,f13,f14'; // 拥挤度：成交额/码/市场/名
const FIELDS_INDEX = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f107,f170'; // 指数/ETF：价/额/码/名/昨收/涨跌幅

// 全 A 股 spot 过滤
const FS_ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

// 指数成分股 fs 过滤（2025 年后 b:<indexCode> 已失效，改为按市场+板块过滤）
const INDEX_FS = {
  '000001': { primary: 'm:1+t:2,m:1+t:23', fallbackPrefix: { market: 0, prefixes: ['60', '688'] } }, // 上证：沪主板+科创
  '399006': { primary: 'm:0+t:80', fallbackPrefix: { market: 1, prefixes: ['30'] } }, // 创业板
};

// secid 规则：SH(6/68/ETF 51/52/56/58)→1.<code>，SZ(0/3/ETF 15/16/18)→0.<code>
function toSecid(code, exchange) {
  if (exchange === 'SH') return `1.${code}`;
  if (exchange === 'SZ') return `0.${code}`;
  // 自动推断
  if (/^(6|51|52|56|58)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

function num(v) {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 解析 clist/get 响应的 diff[] 行
function parseDiffRows(data, fieldMap) {
  const diff = data && data.data && data.data.diff;
  if (!Array.isArray(diff)) return [];
  return diff.map((row) => {
    const obj = {};
    for (const [field, key] of Object.entries(fieldMap)) {
      obj[key] = row[field];
    }
    return obj;
  });
}

// 东财 push2 被封时返回 HTML "URL过滤"，据此判定
function isEmBlocked(data) {
  return typeof data === 'string' && data.includes('URL');
}

// 从全 A 行情派生指数成分股（同源：同一批数据按前缀过滤，保证拥挤度分子分母口径一致）
function deriveConstituents(allShares, indexCode) {
  const cfg = INDEX_FS[indexCode];
  if (!cfg || !cfg.fallbackPrefix) return [];
  const { market, prefixes } = cfg.fallbackPrefix;
  return allShares
    .filter((r) => r.market === market && prefixes.some((p) => r.code.startsWith(p)))
    .map((r) => ({ code: r.code, name: r.name, market: r.market, amount: r.amount }));
}

// B 股成交额（新浪分页，sh_b/sz_b）。成交额计入两市总成交额。
async function fetchBShares(http, { onProgress } = {}) {
  const all = [];
  for (const node of ['sh_b', 'sz_b']) {
    const pageSize = 80;
    for (let page = 1; page <= 10; page++) {
      const rows = await http.get(SINA_BULK_URL, {
        params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node, symbol: '', _s_r_a: 'init' },
        headers: { Referer: SINA_REFERER },
        source: `bShares:sina:${node}:p${page}`,
        sina: { minGap: randInt(1500, 3000) },
      });
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        all.push({
          code: String(r.code),
          name: r.name,
          market: r.symbol && r.symbol.startsWith('sh') ? 0 : 1,
          amount: num(r.amount) || 0,
        });
      }
      onProgress && onProgress({ stage: 'bShare', page, got: all.length, node });
      if (rows.length < pageSize) break;
      await sleep(randInt(SINA_PAGE_DELAY.min, SINA_PAGE_DELAY.max));
    }
  }
  return all;
}

module.exports = {
  EM_CLIST_URL, EM_STOCK_GET_URL, EM_DATACENTER_URL, COMMON_PARAMS,
  FIELDS_BREADTH, FIELDS_CROWD, FIELDS_INDEX, FS_ALL_A, INDEX_FS,
  toSecid, num, parseDiffRows, isEmBlocked,
  deriveConstituents, fetchBShares,
};
