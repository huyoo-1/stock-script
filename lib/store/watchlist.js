// 关注列表存储：单文件 data/watchlist.json，纯代码数组，原子写。
// 跨设备共享：Web 面板读写，替代前端 localStorage。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'watchlist.json');

let logger = null;

function setLogger(l) {
  logger = l;
}

function log(level, msg, extra) {
  if (!logger) return;
  logger[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](msg, extra);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 读取关注列表；文件不存在或损坏返回 []
function loadWatchlist() {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(arr) ? arr.filter((c) => /^\d{6}$/.test(String(c))) : [];
  } catch {
    return [];
  }
}

// 保存关注列表：去重 + 6 位代码校验 + 原子写，返回新数组
function saveWatchlist(codes) {
  if (!Array.isArray(codes)) throw new Error('codes 必须为数组');
  const seen = new Set();
  const valid = [];
  for (const c of codes) {
    const code = String(c);
    if (!/^\d{6}$/.test(code)) throw new Error(`无效代码：${code}`);
    if (seen.has(code)) continue;
    seen.add(code);
    valid.push(code);
  }
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valid, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  log('info', `关注列表已保存 ${valid.length} 只`);
  return valid;
}

module.exports = { setLogger, loadWatchlist, saveWatchlist };
