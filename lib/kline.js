// 日 K 线数据源：腾讯主源（ifzq.gtimg.cn + proxy.finance.qq.com 兜底），新浪 JSONP 兜底。
// 用途：技术筛选的 MA20 二次精筛。本地只积累近 10 个交易日，不足 20 日均线样本，
// 因此只对粗筛候选调用数据源补拉日 K，避免逐股全量抓取。
// 防封：同源随机间隔（600-1200ms）+ 低并发 + 失败缓存；501 视为 WAF 封禁，快速失败并冷却该域名。
const SINA_REFERER = 'https://finance.sina.com.cn/';

const TENCENT_KLINE_URL = 'https://ifzq.gtimg.cn/appstock/app/fqkline/get'; // web.ifzq 偶发被 WAF 501，主用 ifzq
const TENCENT_KLINE_URL_FALLBACK = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get';
const SINA_KLINE_URL = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData';

const DEFAULT_MA20_DAYS = 20;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

// 腾讯同源请求间隔（毫秒）：随机化避免固定节奏被识别
const TENCENT_GAP = { min: 600, max: 1200 };
// 501（WAF 反爬页）后的域名冷却时间
const TENCENT_BLOCK_COOLDOWN_MS = 120000;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 被 WAF 临时封禁的域名 → 解封时间戳
const blockedHosts = new Map();

function hostBlockedUntil(url) {
  const until = blockedHosts.get(url) || 0;
  return until > Date.now() ? until : 0;
}

function markHostBlocked(url, err) {
  const status = err && (err.status || err.httpStatus || (err.response && err.response.status));
  if (status === 501) blockedHosts.set(url, Date.now() + TENCENT_BLOCK_COOLDOWN_MS);
}

// 进程内缓存：同一代码在 TTL 内不重复请求（Web 反复打开筛选页时避免打爆数据源）
const cache = new Map();

function num(v) {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 腾讯/新浪统一代码前缀：沪 6/5/900，北交所 4/8/92，其余深市
function toSecid(code) {
  const c = String(code);
  if (c.startsWith('900')) return `sh${c}`;
  if (/^(4|8|92)/.test(c)) return `bj${c}`;
  if (/^(5|6)/.test(c)) return `sh${c}`;
  return `sz${c}`;
}

function meanOfLast(values, n) {
  if (!Array.isArray(values) || values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

// 腾讯日 K：data[secid].day 为 [日期, 开, 收, 高, 低, 量, ...] 的数组
function parseTencentKline(data, secid) {
  const node = data && data.data && data.data[secid];
  const rows = node && (Array.isArray(node.day) ? node.day : Array.isArray(node.qfqday) ? node.qfqday : null);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      date: r && r[0],
      open: num(r && r[1]),
      close: num(r && r[2]),
      high: num(r && r[3]),
      low: num(r && r[4]),
      volume: num(r && r[5]),
    }))
    .filter((r) => r.date && Number.isFinite(r.close));
}

async function fetchTencentKlines(http, code, days) {
  const secid = toSecid(code);
  const opts = {
    params: { param: `${secid},day,,,${days},` },
    headers: { Referer: 'https://gu.qq.com/' },
    source: `kline:tencent:${code}`,
    minGap: randInt(TENCENT_GAP.min, TENCENT_GAP.max), // 随机间隔，避免固定节奏
    maxRetries: 1, // 501 由 http 客户端快速失败，普通错误只重试一次
  };
  // 主域名处于 501 冷却期时直接走备选域名
  if (!hostBlockedUntil(TENCENT_KLINE_URL)) {
    try {
      return await fetchTencentKlineOnce(http, TENCENT_KLINE_URL, opts, secid);
    } catch (e) {
      markHostBlocked(TENCENT_KLINE_URL, e);
    }
  }
  // 腾讯 WAF 会临时封禁某个域名（501 反爬页），换备选域名
  opts.source = `kline:tencent-alt:${code}`;
  opts.maxRetries = 1;
  return await fetchTencentKlineOnce(http, TENCENT_KLINE_URL_FALLBACK, opts, secid);
}

async function fetchTencentKlineOnce(http, url, opts, secid) {
  const data = await http.get(url, opts);
  if (data && data.code !== 0) {
    throw new Error(`腾讯日K返回异常 code=${data.code} msg=${data.msg || ''}`);
  }
  const rows = parseTencentKline(data, secid);
  if (rows.length === 0) throw new Error(`腾讯日K无数据 ${secid}`);
  return rows;
}

// 新浪 JSONP：var _data=[{day,open,high,low,close,volume},...];
function parseSinaKline(text) {
  if (typeof text !== 'string') return [];
  let body = text.trim();
  const eq = body.indexOf('=');
  if (eq >= 0) body = body.slice(eq + 1);
  body = body.replace(/;\s*$/, '').trim();
  // 新浪实际返回 var _data=([...]);，需去掉外层括号
  if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1).trim();
  let arr;
  try {
    arr = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => ({
      date: r && r.day,
      open: num(r && r.open),
      close: num(r && r.close),
      high: num(r && r.high),
      low: num(r && r.low),
      volume: num(r && r.volume),
    }))
    .filter((r) => r.date && Number.isFinite(r.close));
}

async function fetchSinaKlines(http, code, days) {
  const symbol = toSecid(code);
  const text = await http.get(SINA_KLINE_URL, {
    params: { symbol, scale: '240', ma: 'no', datalen: String(days) },
    headers: { Referer: SINA_REFERER },
    source: `kline:sina:${code}`,
    responseType: 'text',
    maxRetries: 2,
  });
  const rows = parseSinaKline(text);
  if (rows.length === 0) throw new Error(`新浪日K无数据 ${symbol}`);
  return rows;
}

// 按配置顺序抓取：auto = 腾讯 → 新浪；单源失败时记录日志并尝试下一个
async function fetchKlines({ http, code, days, source = 'auto', logger } = {}) {
  const want = days || DEFAULT_MA20_DAYS;
  if (source !== 'sina') {
    try {
      const rows = await fetchTencentKlines(http, code, want);
      if (rows.length >= want) return { rows, source: 'tencent' };
      logger && logger.warn(`腾讯日K数据不足 ${code}（${rows.length}/${want}）`);
    } catch (e) {
      logger && logger.warn(`腾讯日K抓取失败 ${code}`, e.message);
      if (source === 'tencent') return { rows: [], source: 'tencent' };
    }
  }
  if (source !== 'tencent') {
    try {
      const rows = await fetchSinaKlines(http, code, want);
      if (rows.length >= want) return { rows, source: 'sina' };
      logger && logger.warn(`新浪日K数据不足 ${code}（${rows.length}/${want}）`);
    } catch (e) {
      logger && logger.warn(`新浪日K抓取失败 ${code}`, e.message);
    }
  }
  return { rows: [], source: source === 'auto' ? 'none' : source };
}

// MA20 数据提供者：返回 { enabled, source, fetch, concurrency }。
// fetch(code) => Promise<number|null>，null 表示数据不足/全部失败，调用方计为缺失。
function createMa20Provider({ http, config, logger } = {}) {
  const sc = (config && config.screener) || {};
  const source = sc.ma20Source || 'auto';
  const days = sc.ma20Days || DEFAULT_MA20_DAYS;
  const ttl = sc.cacheTtlMs != null ? sc.cacheTtlMs : DEFAULT_TTL_MS;
  const concurrency = sc.concurrency || 8;
  const enabled = source !== 'off';

  async function fetch(code) {
    const key = String(code);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < ttl) return hit.ma20;
    const { rows } = await fetchKlines({ http, code: key, days, source, logger });
    const ma20 = meanOfLast(rows.map((r) => r.close), days);
    const value = ma20 == null ? null : Math.round(ma20 * 100) / 100;
    cache.set(key, { ma20: value, fetchedAt: Date.now() });
    return value;
  }

  return { enabled, source, fetch, concurrency, days };
}

function clearKlineCache() {
  cache.clear();
}
  blockedHosts.clear();

module.exports = {
  toSecid, meanOfLast,
  parseTencentKline, parseSinaKline,
  fetchTencentKlines, fetchSinaKlines, fetchKlines,
  createMa20Provider, clearKlineCache,
};
