// 全 A 收盘价快照存储：每个交易日一个 JSON 文件，供未来几天的筛选/走势分析。
// 数据来源：runClose（19:00）抓取的全 A 快照，收盘后 price 即当日收盘价。
// 设计：按日文件 + 内存缓存 + 只保留最近约一年（约 370 天），JSON 足够支撑。
const fs = require('fs');
const path = require('path');

const PRICE_DIR = path.join(__dirname, '..', 'data', 'price_history');
const KEEP_DAYS = 370; // 约一年

let logger = null;

function setLogger(l) {
  logger = l;
}

function log(level, msg, extra) {
  if (!logger) return;
  logger[level](msg, extra);
}

function ensureDir() {
  if (!fs.existsSync(PRICE_DIR)) fs.mkdirSync(PRICE_DIR, { recursive: true });
}

function dayPath(dateStr) {
  return path.join(PRICE_DIR, `${dateStr}.json`);
}

function listDayFiles() {
  ensureDir();
  return fs.readdirSync(PRICE_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// 保存当日全 A 快照（收盘价）。close 为 null 表示当日无有效价格（停牌/数据缺失）。
function saveDaySnapshot(dateStr, allShares) {
  ensureDir();
  const rows = allShares
    .filter((r) => r && r.code)
    .map((r) => ({
      code: String(r.code),
      name: r.name || '',
      close: Number.isFinite(r.price) ? r.price : null,
      amount: Number.isFinite(r.amount) ? r.amount : 0,
      market: r.market,
    }));
  const file = dayPath(dateStr);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows), 'utf8');
  fs.renameSync(tmp, file);
  log('info', `价格快照已保存 ${dateStr} ${rows.length} 只`);
  cleanupOld();
  return rows.length;
}

// 读取某日快照；文件不存在或损坏返回 null
function loadDay(dateStr) {
  try {
    const rows = JSON.parse(fs.readFileSync(dayPath(dateStr), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

// 加载最近 N 个交易日的快照（按日期升序）
function loadRecentDays(days) {
  const files = listDayFiles().slice(-days);
  const out = [];
  for (const f of files) {
    const date = path.basename(f, '.json');
    const rows = loadDay(date);
    if (rows) out.push({ date, rows });
  }
  return out;
}

// 某只股票最近 N 个交易日的收盘价序列（升序，缺数据的交易日跳过）
function getStockSeries(code, days) {
  const seq = [];
  for (const day of loadRecentDays(days)) {
    const r = day.rows.find((x) => x.code === code);
    if (r && r.close != null) seq.push({ date: day.date, close: r.close, name: r.name });
  }
  return seq;
}

// 清理超过 KEEP_DAYS 的旧快照文件
function cleanupOld() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of listDayFiles()) {
    const full = path.join(PRICE_DIR, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch (e) {
      log('warn', `清理旧价格快照失败 ${f}`, e.message);
    }
  }
  if (removed > 0) log('info', `清理过期价格快照 ${removed} 个`);
}

module.exports = { setLogger, saveDaySnapshot, loadDay, loadRecentDays, getStockSeries, PRICE_DIR };
