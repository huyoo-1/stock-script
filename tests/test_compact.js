const path = require('path');
const fs = require('fs');
const { createLogger } = require('../lib/log');
const history = require('../lib/history');

const logger = createLogger(path.join(__dirname, '..', 'logs'));
history.setLogger(logger);

// 清理
const { HISTORY_DIR, BACKUP_DIR } = history;
try { fs.rmSync(HISTORY_DIR, { recursive: true, force: true }); } catch {}
try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}

// 构造一些测试数据，含重复日期和无效记录
const baseRecord = {
  type: 'close',
  indices: [{ code: '000001', name: '上证指数', crowding: 40, level: 'normal' }],
  breadth: { up: 1, down: 1, flat: 0, limitUp: 0, limitDown: 0, totalAmountYi: 10000, tier: '中等活跃' },
};

(async () => {
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-01' }, 30);
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-02' }, 30);
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-02', breadth: { ...baseRecord.breadth, totalAmountYi: 99999 } }, 30);
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-03' }, 30);
  // 无效记录应被忽略
  await history.upsertCloseRecord({ date: '2026-08-04' }, 30);

  console.log('compact 前记录数:', history.readHistory().length);
  console.log('2026-08-02 重复前成交额:', history.getRecordByDate('2026-08-02').breadth.totalAmountYi);

  history.compactHistory(30);

  console.log('compact 后记录数:', history.readHistory(true).length);
  console.log('2026-08-02 去重后成交额:', history.getRecordByDate('2026-08-02').breadth.totalAmountYi);
  console.log('08-04 无效记录:', history.getRecordByDate('2026-08-04'));
  console.log('年份文件:', fs.readdirSync(HISTORY_DIR));
  console.log('备份文件数:', fs.readdirSync(BACKUP_DIR).length);

  // 跑完自动清理测试数据，避免污染真实历史
  try { fs.rmSync(HISTORY_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}
  console.log('测试数据已清理');
})();
