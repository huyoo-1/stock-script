// JSON 历史读写：仅收盘记录落盘，原子写防崩溃损坏。
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// 原子写：写 .tmp 再 rename
function writeHistory(records) {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = HISTORY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_PATH);
}

// 插入/覆盖当日收盘记录，裁剪保留 historyDays 条
function upsertCloseRecord(record, historyDays) {
  const records = readHistory();
  const idx = records.findIndex((r) => r.date === record.date);
  if (idx >= 0) records[idx] = record; // 覆盖
  else records.push(record);
  // 按日期排序，裁剪
  records.sort((a, b) => a.date.localeCompare(b.date));
  while (records.length > historyDays) records.shift();
  writeHistory(records);
}

// 取最近 N 条收盘记录（升序）
function getRecentClose(days) {
  const records = readHistory();
  return records.slice(-days);
}

// 取上一交易日收盘记录（用于融资融券变动 + ETF 前日成交额）
function getPrevClose(todayStr) {
  const records = readHistory();
  const before = records.filter((r) => r.date < todayStr);
  if (before.length === 0) return null;
  return before[before.length - 1];
}

module.exports = { readHistory, writeHistory, upsertCloseRecord, getRecentClose, getPrevClose, HISTORY_PATH };
