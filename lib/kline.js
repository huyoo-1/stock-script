// 日 K 线纯函数工具 + MA20 数据提供者。
// 抓取逻辑已迁至 lib/data/kline.js 的 fetcher（TencentKlineFetcher/SinaKlineFetcher），
// 本文件只保留：toSecid/num/meanOfLast/parseTencentKline/parseSinaKline/clearKlineCache/createMa20Provider。

const DEFAULT_MA20_DAYS = 20;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

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

// 新浪 JSONP：var _data=[{day,open,high,low,close,volume},...];
function parseSinaKline(text) {
  if (typeof text !== 'string') return [];
  let body = text.trim();
  // 新浪返回可能以 /* <script>...</script> */ 注释开头，里面有等号，不能按第一个 '=' 截断
  body = body.replace(/\/\*[\s\S]*?\*\//, '').trim();
  // 定位 JSONP 变量赋值：var _data=[...];
  const idx = body.indexOf('var _data=');
  if (idx >= 0) body = body.slice(idx + 'var _data='.length);
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

// 进程内缓存：同一代码在 TTL 内不重复请求
const cache = new Map();

// MA20 数据提供者：返回 { enabled, source, fetch, concurrency, days }。
// fetch(code) => Promise<number|null>，null 表示数据不足/全部失败，调用方计为缺失。
// fetcherMgr: 可选，传入则走策略模式（按 capability='kline' 路由）；不传则 fetch 恒返回 null。
function createMa20Provider({ http, config, logger, fetcherMgr } = {}) {
  const sc = (config && config.screener) || {};
  const source = sc.ma20Source || 'auto';
  const days = sc.ma20Days || DEFAULT_MA20_DAYS;
  const ttl = sc.cacheTtlMs != null ? sc.cacheTtlMs : DEFAULT_TTL_MS;
  const concurrency = sc.concurrency || 8;
  const enabled = source !== 'off' && !!fetcherMgr;

  async function fetch(code) {
    const key = String(code);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < ttl) return hit.ma20;

    // 单源模式：只试指定 fetcher；auto：按优先级全试
    const onlyName = source === 'tencent' ? 'tencentKline' : source === 'sina' ? 'sinaKline' : null;
    const { result } = await fetcherMgr.execute(http, { code: key, days }, {
      capability: 'kline',
      onlyName,
      validate: (rows) => Array.isArray(rows) && rows.length >= days,
    });
    const rows = Array.isArray(result) ? result : [];
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

module.exports = {
  toSecid, meanOfLast,
  parseTencentKline, parseSinaKline,
  createMa20Provider, clearKlineCache,
};
