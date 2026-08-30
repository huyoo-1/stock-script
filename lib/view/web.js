// Web 面板：node:http API + 静态文件伺服（零 npm 依赖）。
// API：
//   GET /api/indices/history?days=60   指数拥挤度历史（sh / cy 双序列）
//   GET /api/intraday?date=today       当日盘中快照轨迹（按时间点）
//   GET /api/stock/{code}?days=60      个股最近 N 日收盘价 + MA5/MA10
//   GET /api/screener?upDays=3         技术筛选结果明细
// 静态：/ 伺服 web/index.html，/vendor/* 伺服本地 Vue/ECharts。
const http = require('http');
const fs = require('fs');
const path = require('path');
const calendar = require('../core/calendar');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// 读 POST body（JSON），上限 1MB 防滥用
function collectBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1e6) { req.destroy(); reject(new Error('body 过大')); }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

let _history = null;
let _priceHistory = null;
let _goldHistory = null;
let _screener = null;
let _ma20 = null;
let _logger = null;
let _watchlist = null;
let _config = null;
let _configPath = null;
let _runClose = null;
let _closeRunning = false;
let _closeStartedAt = 0;
const CLOSE_TIMEOUT_MS = 5 * 60 * 1000; // 收盘流程超时兜底：超过则允许重试

function createWebServer({ config, logger, history, priceHistory, goldHistory, screener, ma20, watchlist, configPath, runClose }) {
  _history = history;
  _priceHistory = priceHistory;
  _goldHistory = goldHistory;
  _screener = screener;
  _ma20 = ma20;
  _logger = logger;
  _watchlist = watchlist;
  _config = config;
  _configPath = configPath;
  _runClose = runClose;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname === '/api/indices/history') return apiIndicesHistory(res, url);
      if (pathname === '/api/intraday') return apiIntraday(res, url);
      if (pathname.startsWith('/api/stock/')) return apiStock(res, pathname, url);
      if (pathname === '/api/screener') return apiScreener(res, url);
      if (pathname === '/api/watchlist') return apiWatchlist(req, res);
      if (pathname === '/api/config') return apiConfig(req, res);
      if (pathname === '/api/run-close') return apiRunClose(res);
      if (pathname === '/api/gold/history') return apiGoldHistory(res, url);
      if (pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
      return serveStatic(req, res, pathname);
    } catch (e) {
      logger && logger.error('Web API 异常', e);
      if (!res.headersSent) json(res, 500, { error: '服务内部错误' });
    }
  });
  server.on('error', (e) => logger && logger.error('Web 服务异常', e.message));
  return server;
}

function clampDays(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 5), 250) : def;
}

// 指数拥挤度历史
function apiIndicesHistory(res, url) {
  const days = clampDays(url.searchParams.get('days'), 60);
  const records = _history.getRecentClose(days);
  const dates = [];
  const sh = [];
  const cy = [];
  for (const r of records) {
    const shRec = r.indices.find((i) => i.code === '000001');
    const cyRec = r.indices.find((i) => i.code === '399006');
    dates.push(r.date.slice(5)); // MM-DD
    sh.push(shRec && shRec.crowding != null ? shRec.crowding : null);
    cy.push(cyRec && cyRec.crowding != null ? cyRec.crowding : null);
  }
  json(res, 200, { dates, sh, cy });
}

// 当日盘中快照轨迹（date=today 解析为当天，否则按 YYYY-MM-DD）
function apiIntraday(res, url) {
  const q = url.searchParams.get('date');
  const dateStr = !q || q === 'today' ? calendar.dateStr(new Date()) : q;
  const records = _history.getDayIntraday(dateStr);
  json(res, 200, { date: dateStr, records });
}

// 个股收盘价 + 均线（逐点 MA5/MA10）
function apiStock(res, pathname, url) {
  const code = pathname.replace('/api/stock/', '').trim();
  if (!/^\d{6}$/.test(code)) return json(res, 400, { error: '代码应为 6 位数字' });
  const days = clampDays(url.searchParams.get('days'), 60);
  const seq = _priceHistory.getStockSeries(code, days);
  const closes = seq.map((s) => s.close);
  const series = seq.map((s, i) => ({
    date: s.date,
    close: s.close,
    ma5: i >= 4 ? Math.round((closes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5) * 100) / 100 : null,
    ma10: i >= 9 ? Math.round((closes.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) / 10) * 100) / 100 : null,
  }));
  json(res, 200, {
    code,
    name: seq.length > 0 ? seq[seq.length - 1].name : '',
    days: series.length,
    series,
  });
}

// 黄金走势：金价序列 + 各黄金股/ETF 收盘价序列（双 Y 轴叠加图数据源）
function apiGoldHistory(res, url) {
  const days = clampDays(url.searchParams.get('days'), 60);
  const data = _goldHistory ? _goldHistory.getGoldSeries(days) : { dates: [], goldPrice: [], stocks: [] };
  json(res, 200, data);
}

// 技术筛选结果：优先读收盘落盘的精筛结果，无缓存或 upDays 不符时回退实时计算
async function apiScreener(res, url) {
  const upDays = Math.min(parseInt(url.searchParams.get('upDays') || '3', 10) || 3, 10);
  const cached = _priceHistory.loadScreenerResult();
  if (cached && cached.items && (cached.upDays === upDays || !cached.upDays)) {
    return json(res, 200, {
      count: cached.count,
      candidates: cached.candidates,
      readyDays: cached.readyDays,
      neededDays: cached.neededDays || _screener.MA10_DAYS,
      checked: cached.checked,
      ma20Missing: cached.ma20Missing,
      ma20Source: cached.ma20Source || 'auto',
      updatedAt: cached.updatedAt,
      items: cached.items,
    });
  }
  // 回退：无落盘结果（首日启动/未跑过收盘）时实时计算
  const recent = _priceHistory.loadRecentDays(_screener.MA10_DAYS);
  const local = _screener.runScreener(recent, { upDays });
  const base = {
    count: local.length,
    candidates: local.length,
    readyDays: _screener.readyDays(recent),
    neededDays: _screener.MA10_DAYS,
    updatedAt: recent.length > 0 ? recent[recent.length - 1].date : null,
  };
  if (_ma20 && _ma20.enabled) {
    const refined = await _screener.applyMa20Filter(local, _ma20.fetch, {
      concurrency: _ma20.concurrency,
      logger: _logger,
    });
    return json(res, 200, {
      ...base,
      count: refined.items.length,
      checked: refined.checked,
      ma20Missing: refined.missing.length,
      ma20Source: _ma20.source,
      items: refined.items,
    });
  }
  return json(res, 200, { ...base, ma20Source: 'off', items: local });
}

// 关注列表：GET 返回纯代码数组，POST 全量替换
async function apiWatchlist(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, _watchlist ? _watchlist.loadWatchlist() : []);
  }
  if (req.method === 'POST') {
    const body = await collectBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON 解析失败' }); }
    if (!parsed || !Array.isArray(parsed.codes)) return json(res, 400, { error: 'codes 必须为数组' });
    try {
      const codes = _watchlist.saveWatchlist(parsed.codes);
      return json(res, 200, { codes, count: codes.length });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
  return json(res, 405, { error: '仅支持 GET/POST' });
}

// 配置：GET 返回（appSecret 脱敏），POST 部分更新写回 config.json
async function apiConfig(req, res) {
  if (req.method === 'GET') {
    if (!_config) return json(res, 200, { config: {} });
    const cfg = JSON.parse(JSON.stringify(_config)); // 解冻拷贝
    if (cfg.feishu && cfg.feishu.appSecret) cfg.feishu.appSecret = '***';
    return json(res, 200, { config: cfg });
  }
  if (req.method === 'POST') {
    const body = await collectBody(req);
    let patch;
    try { patch = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON 解析失败' }); }
    if (!patch || typeof patch !== 'object') return json(res, 400, { error: '配置必须为对象' });
    try {
      const fs = require('fs');
      // 读原始 config.json，合并用户改动，避免漏填字段被清空
      let user = {};
      try { user = JSON.parse(fs.readFileSync(_configPath, 'utf8')); } catch { /* 文件不存在则用空 */ }
      const ONE_LEVEL = ['feishu', 'thresholds', 'web', 'screener', 'dataSources', 'historyStorage'];
      for (const [k, v] of Object.entries(patch)) {
        if (ONE_LEVEL.includes(k) && typeof v === 'object' && !Array.isArray(v)) {
          user[k] = { ...(user[k] || {}), ...v };
        } else {
          user[k] = v;
        }
      }
      // appSecret 为脱敏占位则保留原值
      if (user.feishu && user.feishu.appSecret === '***') {
        const orig = _config.feishu && _config.feishu.appSecret;
        if (orig) user.feishu.appSecret = orig;
      }
      // 合并 DEFAULTS 后校验
      const { DEFAULTS, validateConfig } = require('../core/config');
      const cfg = JSON.parse(JSON.stringify(DEFAULTS));
      for (const k of Object.keys(user)) {
        if (ONE_LEVEL.includes(k) && typeof user[k] === 'object' && !Array.isArray(user[k])) {
          cfg[k] = { ...cfg[k], ...user[k] };
        } else {
          cfg[k] = user[k];
        }
      }
      const errors = validateConfig(cfg);
      if (errors.length > 0) return json(res, 400, { error: '配置校验失败：\n  - ' + errors.join('\n  - ') });
      // 写回（不含 DEFAULTS，保持 config.json 精简）
      const { saveConfig, mergeDefaults } = require('../core/config');
      saveConfig(_configPath, user);
      // 刷新内存 _config，使后续保存的 appSecret 还原源与磁盘一致
      _config = Object.freeze(mergeDefaults(user));
      _logger && _logger.info('配置已通过 Web 面板更新');
      return json(res, 200, { ok: true, needRestart: true, message: '配置已保存，需重启服务生效' });
    } catch (e) {
      _logger && _logger.error('配置保存失败', e);
      return json(res, 500, { error: '配置保存失败：' + e.message });
    }
  }
  return json(res, 405, { error: '仅支持 GET/POST' });
}

// 手动触发收盘流程：防重入，异步执行，超时兜底
async function apiRunClose(res) {
  if (!_runClose) return json(res, 500, { error: '未配置收盘流程' });
  // 非交易日禁止触发，避免覆盖最近有效收盘数据
  if (!calendar.isTradingDay(new Date())) {
    return json(res, 400, { ok: false, skipped: true, message: '非交易日，已跳过收盘流程' });
  }
  // 超时兜底：runClose 卡死导致 _closeRunning 永久 true 时，超过阈值强制放行
  if (_closeRunning) {
    if (Date.now() - _closeStartedAt > CLOSE_TIMEOUT_MS) {
      _logger && _logger.warn('收盘流程超时未结束，强制重置防重入标志');
      _closeRunning = false;
    } else {
      return json(res, 409, { error: '已有收盘任务在跑，请稍后重试' });
    }
  }
  _closeRunning = true;
  _closeStartedAt = Date.now();
  try {
    const result = await _runClose();
    if (result && result.skipped) {
      return json(res, 202, { ok: true, skipped: true, message: result.reason || '已跳过' });
    }
    return json(res, 202, { ok: true, message: '收盘流程已触发并完成' });
  } catch (e) {
    _logger && _logger.error('Web 触发收盘流程失败', e);
    return json(res, 500, { error: '收盘流程执行失败：' + e.message });
  } finally {
    _closeRunning = false;
  }
}

// 静态文件伺服（防目录穿越）
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(WEB_DIR, rel);
  if (filePath !== WEB_DIR && !filePath.startsWith(WEB_DIR + path.sep)) {
    return json(res, 403, { error: '禁止访问' });
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return json(res, 404, { error: '文件不存在' });
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=86400',
  });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = { createWebServer, WEB_DIR };
