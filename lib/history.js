// 本地 JSON 历史存储：仅收盘记录落盘，支持进程缓存、简单写锁、自动备份、数据校验、按年分目录。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const BACKUP_DIR = path.join(DATA_DIR, 'history_backup');

let cache = null;
let cacheLoadedAt = 0;
let writing = false;
let logger = null;

function setLogger(l) {
  logger = l;
}

function log(level, msg, extra) {
  if (!logger) return;
  logger[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](msg, extra);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function yearOf(dateStr) {
  return dateStr.slice(0, 4);
}

function yearPath(dateStr) {
  return path.join(HISTORY_DIR, `${yearOf(dateStr)}.json`);
}

function listYearFiles() {
  ensureDir(HISTORY_DIR);
  return fs.readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => path.join(HISTORY_DIR, f))
    .sort();
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      log('warn', `读取历史文件失败 ${filePath}`, e.message);
    }
    return [];
  }
}

function readAllRecords() {
  const records = [];
  for (const file of listYearFiles()) {
    const rows = readJsonFile(file);
    if (Array.isArray(rows)) records.push(...rows);
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}

// 带缓存的读取：文件修改时间未变化时直接返回缓存
function readHistory(force = false) {
  if (!force && cache !== null) return cache;
  cache = readAllRecords();
  cacheLoadedAt = Date.now();
  return cache;
}

function isValidRecord(r) {
  if (!r || typeof r !== 'object') return false;
  if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
  if (r.type !== 'close') return false;
  if (!Array.isArray(r.indices) || r.indices.length === 0) return false;
  if (!r.breadth || typeof r.breadth !== 'object') return false;
  return true;
}

function backupFile(filePath) {
  ensureDir(BACKUP_DIR);
  try {
    if (fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(BACKUP_DIR, `${path.basename(filePath)}.${ts}`));
    }
  } catch (e) {
    log('warn', '备份历史文件失败', e.message);
  }
}

// 原子写：备份 → 写 .tmp → rename
function writeYearFile(dateStr, records) {
  const filePath = yearPath(dateStr);
  ensureDir(path.dirname(filePath));
  backupFile(filePath);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// 清理过期备份文件，保留 backupRetentionDays 天内
function cleanupBackups(backupRetentionDays = 30) {
  ensureDir(BACKUP_DIR);
  if (backupRetentionDays <= 0) return;
  const cutoff = Date.now() - backupRetentionDays * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(BACKUP_DIR);
    let removed = 0;
    for (const file of files) {
      const full = path.join(BACKUP_DIR, file);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch (e) {
        log('warn', `清理备份文件失败 ${full}`, e.message);
      }
    }
    if (removed > 0) log('info', `清理过期备份 ${removed} 个`);
  } catch (e) {
    log('warn', '读取备份目录失败', e.message);
  }
}

async function withLock(fn) {
  if (writing) {
    log('warn', '历史文件写入冲突，等待前一次写入完成');
    while (writing) await new Promise((r) => setTimeout(r, 10));
  }
  writing = true;
  try {
    return await fn();
  } finally {
    writing = false;
  }
}

// 按年份分组记录
function groupByYear(records) {
  const map = {};
  for (const r of records) {
    const y = yearOf(r.date);
    if (!map[y]) map[y] = [];
    map[y].push(r);
  }
  return map;
}

// 重新整理所有年份文件：删除空文件、合并重复日期、清理过期备份
function compactHistory(historyDays, backupRetentionDays = 30) {
  const all = readAllRecords();
  const seen = new Set();
  const deduped = [];
  for (const r of all) {
    if (!isValidRecord(r)) continue;
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    deduped.push(r);
  }
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  while (deduped.length > historyDays) deduped.shift();

  const grouped = groupByYear(deduped);
  for (const [y, records] of Object.entries(grouped)) {
    writeYearFile(`${y}-01-01`, records);
  }

  // 清理空年份文件
  for (const file of listYearFiles()) {
    const y = path.basename(file, '.json');
    if (!grouped[y]) {
      try {
        backupFile(file);
        fs.unlinkSync(file);
      } catch (e) {
        log('warn', `清理空历史文件失败 ${file}`, e.message);
      }
    }
  }

  // 清理过期备份
  cleanupBackups(backupRetentionDays);

  cache = deduped;
  cacheLoadedAt = Date.now();
  return deduped;
}

// 插入/覆盖当日收盘记录
async function upsertCloseRecord(record, historyDays) {
  if (!isValidRecord(record)) {
    log('error', '尝试写入无效收盘记录', record);
    return;
  }
  await withLock(() => {
    const records = readAllRecords();
    const idx = records.findIndex((r) => r.date === record.date);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    records.sort((a, b) => a.date.localeCompare(b.date));
    while (records.length > historyDays) records.shift();

    const grouped = groupByYear(records);
    for (const [y, yearRecords] of Object.entries(grouped)) {
      writeYearFile(`${y}-01-01`, yearRecords);
    }

    cache = records;
    cacheLoadedAt = Date.now();
    log('info', `历史记录已写入 ${record.date}`);
  });
}

// 取最近 N 条收盘记录（升序）
function getRecentClose(days) {
  const records = readHistory();
  return records.slice(-days);
}

// 取上一交易日收盘记录
function getPrevClose(todayStr) {
  const records = readHistory();
  const before = records.filter((r) => r.date < todayStr);
  if (before.length === 0) return null;
  return before[before.length - 1];
}

// 获取指定日期记录
function getRecordByDate(dateStr) {
  const records = readHistory();
  return records.find((r) => r.date === dateStr) || null;
}

// 导出路径与工具函数
module.exports = {
  setLogger,
  readHistory,
  upsertCloseRecord,
  getRecentClose,
  getPrevClose,
  getRecordByDate,
  compactHistory,
  isValidRecord,
  DATA_DIR,
  HISTORY_DIR,
  BACKUP_DIR,
};
