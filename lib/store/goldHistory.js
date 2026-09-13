// 黄金数据按日文件存储：每个交易日一个 JSON 文件，供 Web 面板走势回看。
// 数据来源：runClose（19:00）抓取的伦敦金现货金价 + 黄金股/ETF 收盘价（从全A快照 filter）。
// 设计：按日文件 + 原子写 + 只保留最近约一年（约 370 天），与 priceHistory 同构。
const fs = require('fs');
const path = require('path');

const GOLD_DIR = path.join(__dirname, '..', '..', 'data', 'gold_history');
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
  if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });
}

function dayPath(dateStr) {
  return path.join(GOLD_DIR, `${dateStr}.json`);
}

function listDayFiles() {
  ensureDir();
  return fs.readdirSync(GOLD_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// 存当日黄金快照：{ goldPrice:{code,name,price,preClose,high,low,date}, stocks:[{code,name,close,chgPct}] }
function saveGoldSnapshot(dateStr, data) {
  ensureDir();
  const tmp = dayPath(dateStr) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, dayPath(dateStr));
  log('info', `黄金快照已保存 ${dateStr}`);
  cleanupOld();
  return data;
}

// 读取某日快照；文件不存在/损坏/非对象返回 null
function loadGoldDay(dateStr) {
  try {
    const rows = JSON.parse(fs.readFileSync(dayPath(dateStr), 'utf8'));
    return rows && typeof rows === 'object' ? rows : null;
  } catch {
    return null;
  }
}

// 加载最近 N 个交易日的快照（按日期升序）
function loadGoldRecentDays(days) {
  const files = listDayFiles().slice(-days);
  const out = [];
  for (const f of files) {
    const date = path.basename(f, '.json');
    const data = loadGoldDay(date);
    if (data) out.push({ date, ...data });
  }
  return out;
}

// 取金价序列 + 各黄金股/ETF 收盘价序列，供 Web 图表叠加
function getGoldSeries(days) {
  const daysData = loadGoldRecentDays(days);
  const dates = daysData.map((d) => d.date);
  const goldPrice = daysData.map((d) => d.goldPrice && d.goldPrice.price);
  // 收集所有出现过的标的代码（配置可能变动，历史数据里有的都展示）
  const stocks = {};
  for (const d of daysData) {
    for (const s of (d.stocks || [])) {
      if (!stocks[s.code]) stocks[s.code] = { code: s.code, name: s.name, series: [] };
    }
  }
  for (const d of daysData) {
    for (const code of Object.keys(stocks)) {
      const s = (d.stocks || []).find((x) => x.code === code);
      stocks[code].series.push(s ? s.close : null);
    }
  }
  return { dates, goldPrice, stocks: Object.values(stocks) };
}

// 清理超过 KEEP_DAYS 的旧快照（按文件名日期，非 mtime）
function cleanupOld() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let removed = 0;
  for (const f of listDayFiles()) {
    const fileDate = f.slice(0, 10);
    if (fileDate < cutoff) {
      try {
        fs.unlinkSync(path.join(GOLD_DIR, f));
        removed++;
      } catch (e) {
        log('warn', `清理旧黄金快照失败 ${f}`, e.message);
      }
    }
  }
  if (removed > 0) log('info', `清理过期黄金快照 ${removed} 个`);
}

module.exports = {
  setLogger, saveGoldSnapshot, loadGoldDay, loadGoldRecentDays, getGoldSeries, cleanupOld, GOLD_DIR,
};
