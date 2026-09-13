// A 股交易日历判断。节假日读 data/holidays.json（手工维护当年）。
const fs = require('fs');
const path = require('path');

const HOLIDAYS_PATH = path.join(__dirname, '..', '..', 'data', 'holidays.json');

let _holidays = null;
function loadHolidays() {
  if (_holidays !== null) return _holidays;
  try {
    _holidays = new Set(JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8')));
  } catch {
    _holidays = new Set();
  }
  return _holidays;
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isHoliday(d) {
  return loadHolidays().has(dateStr(d));
}

function isTradingDay(d = new Date()) {
  return !isWeekend(d) && !isHoliday(d);
}

// 交易时段：09:30-11:30 或 13:00-15:00
function isTradingHour(d = new Date()) {
  const mins = d.getHours() * 60 + d.getMinutes();
  return (mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900);
}

function isLunchBreak(d = new Date()) {
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins > 690 && mins < 780;
}

function isAfterClose(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() > 900;
}

// 今日 HH:MM 的 Date
function todayAtHHMM(hhmm, base = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

module.exports = {
  loadHolidays, dateStr, isWeekend, isHoliday,
  isTradingDay, isTradingHour, isLunchBreak, isAfterClose, todayAtHHMM,
};
