// 东方财富数据封装：clist/get（成分股/全A/ETF）、stock/get（指数/ETF）、datacenter（融资融券）。
// 请求参数与字段码核实自参考程序 alphasift_service.py:1992-2003。
const path = require('path');
const fs = require('fs');

const EM_CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
const EM_STOCK_GET_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

// 新浪备选源（东财 push2 被封时降级）
const SINA_HQ_URL = 'https://hq.sinajs.cn/list=';
const SINA_BULK_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_REFERER = 'https://finance.sina.com.cn/';

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
const FIELDS_BREADTH = 'f2,f3,f12,f13,f14,f18,f6'; // 广度：价/涨跌幅/码/市场/名/昨收/成交额
const FIELDS_CROWD = 'f6,f12,f13,f14'; // 拥挤度：成交额/码/市场/名
const FIELDS_INDEX = 'f2,f3,f4,f12,f14'; // 指数：价/涨跌幅/涨跌额/码/名

// 全 A 股 spot 过滤（akshare 内部值，待 probe 核实行数）
const FS_ALL_A = 'm:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048';

// 指数成分股 fs 过滤（风险 #1，三级降级）
const INDEX_FS = {
  '000001': { primary: 'b:000001', fallbackPrefix: { market: 0, prefixes: ['60', '688'] } }, // 上证：SH 主板+科创
  '399006': { primary: 'b:399006', fallbackPrefix: { market: 1, prefixes: ['30'] } }, // 创业板
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

// 拉全 A 股 spot 表（广度用）。东财 push2 被封时降级新浪。
async function fetchAllAShares(http) {
  try {
    const data = await http.get(EM_CLIST_URL, {
      params: { ...COMMON_PARAMS, pz: '6000', fields: FIELDS_BREADTH, fs: FS_ALL_A },
      source: 'allA:em',
    });
    if (!isEmBlocked(data)) {
      return parseDiffRows(data, {
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
    }
  } catch {
    // 落到新浪
  }
  return fetchAllASharesSina(http);
}

// 新浪全 A：分页拉取沪深 A 股（node=hs_a），按成交额降序
async function fetchAllASharesSina(http) {
  const all = [];
  const pageSize = 80;
  for (let page = 1; page <= 80; page++) { // 最多 80 页 ≈ 6400 只
    const rows = await http.get(SINA_BULK_URL, {
      params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node: 'hs_a', symbol: '', _s_r_a: 'init' },
      headers: { Referer: SINA_REFERER },
      source: `allA:sina:p${page}`,
    });
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
    if (rows.length < pageSize) break; // 最后一页
  }
  return all;
}

// 东财 push2 被封时返回 HTML "URL过滤"，据此判定
function isEmBlocked(data) {
  return typeof data === 'string' && data.includes('URL');
}

// 拉指数成分股（三级降级）
async function fetchIndexConstituents(http, indexCode) {
  const cfg = INDEX_FS[indexCode];
  if (!cfg) throw new Error(`未配置指数 ${indexCode} 的成分股过滤`);

  // ① primary: b:<indexCode>
  try {
    const data = await http.get(EM_CLIST_URL, {
      params: { ...COMMON_PARAMS, pz: '3000', fields: FIELDS_CROWD, fs: cfg.primary },
      source: `constituents:${indexCode}:primary`,
    });
    const rows = parseDiffRows(data, { f6: 'amount', f12: 'code', f13: 'market', f14: 'name' })
      .map((r) => ({ code: String(r.code), name: r.name, market: r.market, amount: num(r.amount) || 0 }));
    if (rows.length > 0) return { rows, source: `primary:${cfg.primary}` };
  } catch (e) {
    // 落到 fallback
  }

  // ② fallback: 全 A 股按市场+代码前缀过滤
  try {
    const all = await fetchAllAShares(http);
    const { market, prefixes } = cfg.fallbackPrefix;
    const rows = all.filter((r) => r.market === market && prefixes.some((p) => r.code.startsWith(p)))
      .map((r) => ({ code: r.code, name: r.name, market: r.market, amount: r.amount }));
    if (rows.length > 0) return { rows, source: `prefix:${prefixes.join('/')}` };
  } catch (e) {
    // 落到静态表
  }

  // ③ fallback2: 静态成分股表
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

// 拉指数行情（点位/涨跌幅）。东财被封降级新浪。
async function fetchIndexQuote(http, indexCode, exchange) {
  try {
    const secid = toSecid(indexCode, exchange);
    const data = await http.get(EM_STOCK_GET_URL, {
      params: { secid, fields: FIELDS_INDEX, fltt: '2', invt: '2' },
      source: `index:${indexCode}:em`,
    });
    if (!isEmBlocked(data)) {
      const d = data && data.data;
      if (d) {
        return { code: indexCode, name: d.f14, price: num(d.f2), chgPct: num(d.f3), chg: num(d.f4) };
      }
    }
  } catch {
    // 降级
  }
  return fetchSinaQuote(http, indexCode, exchange, 'index');
}

// 拉单只 ETF 成交额。东财被封降级新浪。
async function fetchEtfQuote(http, etfCode) {
  try {
    const secid = toSecid(etfCode, etfCode.startsWith('5') ? 'SH' : 'SZ');
    const data = await http.get(EM_STOCK_GET_URL, {
      params: { secid, fields: 'f6,f12,f14', fltt: '2', invt: '2' },
      source: `etf:${etfCode}:em`,
    });
    if (!isEmBlocked(data)) {
      const d = data && data.data;
      if (d) {
        return { code: String(d.f12 || etfCode), name: d.f14, amount: num(d.f6) || 0 };
      }
    }
  } catch {
    // 降级
  }
  const q = await fetchSinaQuote(http, etfCode, etfCode.startsWith('5') ? 'SH' : 'SZ', 'etf');
  if (!q) return null;
  return { code: etfCode, name: q.name, amount: q.amount };
}

// 新浪行情：hq.sinajs.cn/list=sh000001
// 格式: var hq_str_sh000001="名称,昨收,今开,最新价,最高,最低,买1,卖1,成交量(手),成交额(元),..."
async function fetchSinaQuote(http, code, exchange, kind) {
  const prefix = (exchange === 'SH' ? 'sh' : 'sz') + code;
  const text = await http.get(SINA_HQ_URL + prefix, {
    headers: { Referer: SINA_REFERER },
    source: `sina:${kind}:${code}`,
  });
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

// 拉融资融券余额（风险 #2，字段名待 probe 核实）
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
  fetchAllAShares, fetchIndexConstituents, fetchIndexQuote, fetchEtfQuote, fetchMarginBalance,
};
