// 东方财富数据封装：clist/get（成分股/全A/ETF）、stock/get（指数/ETF）、datacenter（融资融券）。
// 请求参数与字段码核实自参考程序 alphasift_service.py:1992-2003。
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

// 新浪备选源（东财 push2 被封时降级）
const SINA_HQ_URL = 'https://hq.sinajs.cn/list=';
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
// 注：2025 年后 push2.eastmoney.com 对指数/ETF 的 stock/get 旧字段(f2/f3/f4/f12/f14/f18)常返回空 data，改用 f43/f48/f57/f58/f60/f170 这套字段。
const FIELDS_BREADTH = 'f2,f3,f12,f13,f14,f18,f6'; // 广度：价/涨跌幅/码/市场/名/昨收/成交额
const FIELDS_CROWD = 'f6,f12,f13,f14'; // 拥挤度：成交额/码/市场/名
const FIELDS_INDEX = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f107,f170'; // 指数/ETF：价/额/码/名/昨收/涨跌幅

// 全 A 股 spot 过滤（akshare 内部值，待 probe 核实行数）
const FS_ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

// 指数成分股 fs 过滤（2025 年后 b:<indexCode> 已失效，改为按市场+板块过滤）
const INDEX_FS = {
  '000001': { primary: 'm:1+t:2,m:1+t:23', fallbackPrefix: { market: 0, prefixes: ['60', '688'] } }, // 上证：沪主板+科创
  '399006': { primary: 'm:0+t:80', fallbackPrefix: { market: 1, prefixes: ['30'] } }, // 创业板
};

// 新浪分市场成分股：node=sh_a/sz_a/cyb，直接对应指数成分股
// 上证：sh_a（含 60/688 开头）；创业板：cyb（30 开头）
const SINA_INDEX_NODE = {
  '000001': 'sh_a',
  '399006': 'cyb',
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

// ===== 市场快照统一抓取（2026-08-08 重构）=====
// 全 A 与成分股同源：同一批分页数据按前缀过滤派生成分股，避免拥挤度分子分母口径不一致。
// 抓取策略（反爬友好）：新浪分页串行 → 东财大包兜底；456 快速失败降级，不无谓重试加剧封禁。
// onProgress: ({ stage: 'allA'|'bShare', page, got }) => void，用于控制台打印抓取进度。
async function fetchMarketSnapshot(http, { logger, onProgress, maxPages } = {}) {
  let allShares = null;
  let allSource = null;

  // 1. 新浪分页（当前网络更稳定），带进度回调
  try {
    const sina = await fetchAllASharesSina(http, { logger, onProgress, maxPages });
    if (sina.length >= 3000 && sina.reduce((s, r) => s + r.amount, 0) > 1e10) {
      allShares = sina;
      allSource = 'sina';
    } else {
      logger && logger.warn(`新浪全A数据异常（${sina.length} 只），降级东财大包`);
    }
  } catch (e) {
    logger && logger.warn('新浪全A抓取失败', e.message);
  }

  // 2. 东财大包兜底（单请求 pz=6000）
  if (!allShares) {
    try {
      allShares = await fetchAllASharesEm(http);
      allSource = 'eastmoney';
    } catch (e) {
      logger && logger.warn('东财全A大包抓取失败', e.message);
    }
  }

  if (!allShares || allShares.length === 0) {
    return { allShares: [], shConst: [], cyConst: [], bShares: [], allSource: null, error: '全A行情抓取失败（新浪/东财均不可用）' };
  }

  // 3. 成分股从同一批全 A 派生（同源）
  const shConst = deriveConstituents(allShares, '000001');
  const cyConst = deriveConstituents(allShares, '399006');

  // 4. B 股成交额（量小，串行，失败不阻断主流程）
  let bShares = [];
  try {
    bShares = await fetchBShares(http, { logger, onProgress });
  } catch (e) {
    logger && logger.warn('B股成交额抓取失败（忽略）', e.message);
  }

  return { allShares, shConst, cyConst, bShares, allSource };
}

// 新浪全 A 分页（串行，带进度；456 快速失败，已抓部分满足下限时降级使用）
async function fetchAllASharesSina(http, { logger, onProgress, maxPages } = {}) {
  const all = [];
  const pageSize = 80;
  const MAX_PAGES = maxPages > 0 ? maxPages : 80;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let rows;
    try {
      rows = await http.get(SINA_BULK_URL, {
        params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node: 'hs_a', symbol: '', _s_r_a: 'init' },
        headers: { Referer: SINA_REFERER },
        source: `allA:sina:p${page}`,
        sina: { minGap: randInt(1200, 2200) },
      });
    } catch (e) {
      const status = e.status || (e.response && e.response.status);
      if (status === 456) {
        const err = new Error(`新浪反爬封禁(456)，已抓 ${all.length} 只停止`);
        err.status = 456;
        throw err;
      }
      // 其他网络错误：已抓够下限则用部分数据，否则抛出降级东财
      if (all.length >= 3000) {
        logger && logger.warn(`全A新浪分页第${page}页失败，使用已抓 ${all.length} 只`, e.message);
        break;
      }
      throw e;
    }
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
    onProgress && onProgress({ stage: 'allA', page, got: all.length });
    if (rows.length < pageSize) break;
    await sleep(randInt(SINA_PAGE_DELAY.min, SINA_PAGE_DELAY.max));
  }
  return all;
}

// 东财全 A 大包（单请求 pz=6000，timeout 放宽 + 1 次重试）
async function fetchAllASharesEm(http) {
  const data = await http.get(EM_CLIST_URL, {
    params: { ...COMMON_PARAMS, pz: '6000', fields: FIELDS_BREADTH, fs: FS_ALL_A },
    source: 'allA:em',
    timeout: 15000,
    maxRetries: 1,
  });
  if (isEmBlocked(data)) throw new Error('东财大包被 URL 过滤');
  const rows = parseDiffRows(data, {
    f2: 'price', f3: 'chgPct', f12: 'code', f13: 'market', f14: 'name', f18: 'preClose', f6: 'amount',
  }).map((r) => ({
    code: String(r.code),
    name: r.name,
    market: r.market, // 0=SH,1=SZ
    price: num(r.price),
    preClose: num(r.preClose),
    amount: num(r.amount) || 0,
    chgPct: num(r.chgPct),
  }));
  if (rows.length < 3000) throw new Error(`东财大包数据不足（${rows.length} 只）`);
  return rows;
}

// 从全 A 派生成分股（与全 A 同源，避免口径不一致）
function deriveConstituents(allShares, indexCode) {
  const cfg = INDEX_FS[indexCode];
  if (!cfg || !cfg.fallbackPrefix) return [];
  const { market, prefixes } = cfg.fallbackPrefix;
  return allShares
    .filter((r) => r.market === market && prefixes.some((p) => r.code.startsWith(p)))
    .map((r) => ({ code: r.code, name: r.name, market: r.market, amount: r.amount }));
}

// 兼容入口：仅返回全 A（probe 等工具脚本用）
async function fetchAllAShares(http) {
  const snap = await fetchMarketSnapshot(http);
  return snap.allShares;
}

// 新浪指数成分股：直接走分市场 node
async function fetchIndexConstituentsSina(http, indexCode) {
  const node = SINA_INDEX_NODE[indexCode];
  if (!node) return { rows: [], source: 'none' };
  const all = [];
  const pageSize = 80;
  for (let page = 1; page <= 40; page++) { // sh_a 约 30 页，cyb 约 18 页
    const rows = await http.get(SINA_BULK_URL, {
      params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node, symbol: '', _s_r_a: 'init' },
      headers: { Referer: SINA_REFERER },
      source: `constituents:sina:${node}:p${page}`,
      sina: { minGap: randInt(1200, 2200) },
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
    if (rows.length < pageSize) break;
    await sleep(randInt(SINA_PAGE_DELAY.min, SINA_PAGE_DELAY.max));
  }
  return { rows: all, source: `sina:${node}` };
}

// 东财 push2 被封时返回 HTML "URL过滤"，据此判定
function isEmBlocked(data) {
  return typeof data === 'string' && data.includes('URL');
}

// 分页拉取成分股，避免单大包 socket hang up
async function fetchPagedConstituents(http, fs, fields, pageSize = 1000) {
  const all = [];
  for (let pn = 1; pn <= 10; pn++) {
    const data = await http.get(EM_CLIST_URL, {
      params: { ...COMMON_PARAMS, pn: String(pn), pz: String(pageSize), fields, fs },
      source: `constituents:p${pn}`,
      timeout: 20000,
    });
    const diff = data && data.data && data.data.diff;
    if (!Array.isArray(diff) || diff.length === 0) break;
    all.push(...diff);
    if (diff.length < pageSize) break;
  }
  return all;
}

// 拉指数成分股。优先从已抓取的全 A 数据派生（同源，runner 主路径）；
// 未传 allShares 时（probe 等工具）走三级降级：新浪分市场 → 全A过滤 → 东财分页 → 静态表。
async function fetchIndexConstituents(http, indexCode, allShares) {
  const cfg = INDEX_FS[indexCode];
  if (!cfg) throw new Error(`未配置指数 ${indexCode} 的成分股过滤`);

  // ① 派生：从同一批全 A 数据按市场+前缀过滤（同源，推荐）
  if (Array.isArray(allShares) && allShares.length > 0) {
    const rows = deriveConstituents(allShares, indexCode);
    if (rows.length > 0) return { rows, source: 'derive' };
  }

  // ② primary: 新浪分市场节点
  try {
    const result = await fetchIndexConstituentsSina(http, indexCode);
    if (result.rows.length > 0) return result;
  } catch (e) {
    // 落到全 A 过滤
  }

  // ③ fallback: 新浪全 A 按市场+代码前缀过滤
  try {
    const all = await fetchAllAShares(http);
    const { market, prefixes } = cfg.fallbackPrefix;
    const rows = all.filter((r) => r.market === market && prefixes.some((p) => r.code.startsWith(p)))
      .map((r) => ({ code: r.code, name: r.name, market: r.market, amount: r.amount }));
    if (rows.length > 0) return { rows, source: `prefix:${prefixes.join('/')}` };
  } catch (e) {
    // 落到东财分页
  }

  // ③ fallback2: 东财按市场+板块过滤，分页拉取
  try {
    const diff = await fetchPagedConstituents(http, cfg.primary, FIELDS_CROWD, 1000);
    const rows = diff
      .map((r) => ({ code: String(r.f12), name: r.f14, market: r.f13, amount: num(r.f6) || 0 }))
      .filter((r) => r.code && r.code !== 'undefined');
    if (rows.length > 0) return { rows, source: `primary:${cfg.primary}` };
  } catch (e) {
    // 落到静态表
  }

  // ④ fallback3: 静态成分股表
  const staticPath = path.join(__dirname, '..', 'data', 'constituents.json');
  try {
    const map = JSON.parse(fs.readFileSync(staticPath, 'utf8'));
    const codes = map[indexCode] || [];
    const rows = codes.map((code) => ({ code, name: '', market: indexCode === '000001' ? 0 : 1, amount: 0 }));
    return { rows, source: 'static' };
  } catch (e) {
    return { rows: [], source: 'none' };
  }
}

// 拉 B 股成交额（新浪 sh_b / sz_b 节点，量小，带进度）
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

// 拉指数行情（点位/涨跌幅）。新浪优先（东财 push2 当前网络必 hang up），东财仅备选。
async function fetchIndexQuote(http, indexCode, exchange) {
  const sina = await fetchSinaQuote(http, indexCode, exchange, 'index');
  if (sina && sina.price != null) return sina;
  // 备选：东财 stock/get（新浪 hq 偶发失败时兜底）
  try {
    const secid = toSecid(indexCode, exchange);
    const data = await http.get(EM_STOCK_GET_URL, {
      params: { secid, fields: FIELDS_INDEX, fltt: '2', invt: '2' },
      source: `index:${indexCode}:em`,
      maxRetries: 1,
    });
    if (!isEmBlocked(data)) {
      const d = data && data.data;
      if (d && d.f57) {
        return { code: d.f57, name: d.f58, price: num(d.f43), preClose: num(d.f60), amount: num(d.f48), chgPct: num(d.f170) };
      }
    }
  } catch {
    // 新浪与东财均失败，返回 null
  }
  return null;
}

// 拉单只 ETF 成交额。新浪优先（东财 push2 当前网络必 hang up），东财仅备选。
async function fetchEtfQuote(http, etfCode) {
  const exchange = etfCode.startsWith('5') ? 'SH' : 'SZ';
  const q = await fetchSinaQuote(http, etfCode, exchange, 'etf');
  if (q && q.amount != null) {
    return { code: etfCode, name: q.name, price: q.price, preClose: q.preClose, amount: q.amount, chgPct: q.chgPct };
  }
  // 备选：东财 stock/get
  try {
    const secid = toSecid(etfCode, exchange);
    const data = await http.get(EM_STOCK_GET_URL, {
      params: { secid, fields: FIELDS_INDEX, fltt: '2', invt: '2' },
      source: `etf:${etfCode}:em`,
      maxRetries: 1,
    });
    if (!isEmBlocked(data)) {
      const d = data && data.data;
      if (d && d.f57) {
        return { code: d.f57, name: d.f58, price: num(d.f43), preClose: num(d.f60), amount: num(d.f48) || 0, chgPct: num(d.f170) };
      }
    }
  } catch {
    // 新浪与东财均失败
  }
  return null;
}

// 新浪行情：hq.sinajs.cn/list=sh000001
// 格式: var hq_str_sh000001="名称,昨收,今开,最新价,最高,最低,买1,卖1,成交量(手),成交额(元),..."
// 新浪返回 GBK 编码，用 responseType:'arraybuffer' 拿 Buffer 再 TextDecoder('gbk') 解码。
// 走共享 http 客户端，复用反爬/限速/重试/UA 池（独立 axios 会绕过这些）。
async function fetchSinaQuote(http, code, exchange, kind) {
  const prefix = (exchange === 'SH' ? 'sh' : 'sz') + code;
  let buffer;
  try {
    buffer = await http.get(SINA_HQ_URL + prefix, {
      headers: { Referer: SINA_REFERER },
      source: `sina:${kind}:${code}`,
      responseType: 'arraybuffer',
      maxRetries: 1,
    });
  } catch (e) {
    return null;
  }
  const text = new TextDecoder('gbk').decode(buffer);
  if (typeof text !== 'string') return null;
  const m = text.match(/hq_str_\w+="([^"]*)"/);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length < 10) return null;
  const name = parts[0];
  const preClose = num(parts[1]);
  const price = num(parts[3]);
  const amount = num(parts[9]); // 成交额（元）
  const chgPct = preClose && preClose > 0 ? Math.round(((price - preClose) / preClose) * 10000) / 100 : null;
  return { code, name, price, preClose, amount, chgPct, chg: price != null && preClose != null ? Math.round((price - preClose) * 100) / 100 : null };
}

// 拉融资融券余额（风险 #2，字段名已核实）
async function fetchMarginBalance(http) {
  const data = await http.get(EM_DATACENTER_URL, {
    params: {
      reportName: 'RPTA_WEB_MARGIN_DAILYTRADE',
      sortColumns: 'STATISTICS_DATE',
      sortTypes: '-1',
      pageSize: '1',
      pageNumber: '1',
      columns: 'ALL',
      source: 'WEB',
    },
    source: 'margin',
  });
  const rows = data && data.result && data.result.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  return {
    finBalance: num(r.FIN_BALANCE), // 融资余额（亿元）
    loanBalance: num(r.LOAN_BALANCE), // 融券余额（亿元）
    date: r.STATISTICS_DATE,
    source: 'eastmoney',
  };
}

module.exports = {
  EM_CLIST_URL, EM_STOCK_GET_URL, EM_DATACENTER_URL, COMMON_PARAMS,
  FIELDS_BREADTH, FIELDS_CROWD, FIELDS_INDEX, FS_ALL_A, INDEX_FS,
  toSecid,
  fetchMarketSnapshot, fetchAllAShares, fetchAllASharesSina, fetchAllASharesEm, deriveConstituents,
  fetchIndexConstituents, fetchIndexQuote, fetchEtfQuote, fetchMarginBalance, fetchBShares,
};
