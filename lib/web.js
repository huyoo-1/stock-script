// Web 面板：node:http API + 静态文件伺服（零 npm 依赖，只监听 127.0.0.1）。
// API：
//   GET /api/indices/history?days=60   指数拥挤度历史（sh / cy 双序列）
//   GET /api/stock/{code}?days=60      个股最近 N 日收盘价 + MA5/MA10
//   GET /api/screener?upDays=3         技术筛选结果明细
// 静态：/ 伺服 web/index.html，/vendor/* 伺服本地 Vue/ECharts。
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.join(__dirname, '..', 'web');

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

let _history = null;
let _priceHistory = null;
let _screener = null;

function createWebServer({ config, logger, history, priceHistory, screener }) {
  _history = history;
  _priceHistory = priceHistory;
  _screener = screener;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname === '/api/indices/history') return apiIndicesHistory(res, url);
      if (pathname.startsWith('/api/stock/')) return apiStock(res, pathname, url);
      if (pathname === '/api/screener') return apiScreener(res, url);
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

// 技术筛选结果
function apiScreener(res, url) {
  const upDays = Math.min(parseInt(url.searchParams.get('upDays') || '3', 10) || 3, 10);
  const recent = _priceHistory.loadRecentDays(_screener.MA10_DAYS);
  const items = _screener.runScreener(recent, { upDays });
  json(res, 200, {
    count: items.length,
    readyDays: _screener.readyDays(recent),
    neededDays: _screener.MA10_DAYS,
    updatedAt: recent.length > 0 ? recent[recent.length - 1].date : null,
    items,
  });
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
