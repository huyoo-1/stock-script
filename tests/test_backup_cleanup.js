const path = require('path');
const fs = require('fs');
const { createLogger } = require('../lib/log');
const history = require('../lib/history');

const logger = createLogger(path.join(__dirname, '..', 'logs'));
history.setLogger(logger);

const { HISTORY_DIR, BACKUP_DIR } = history;
try { fs.rmSync(HISTORY_DIR, { recursive: true, force: true }); } catch {}
try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}

const baseRecord = {
  type: 'close',
  indices: [{ code: '000001', name: '上证指数', crowding: 40, level: 'normal' }],
  breadth: { up: 1, down: 1, flat: 0, limitUp: 0, limitDown: 0, totalAmountYi: 10000, tier: '中等活跃' },
};

(async () => {
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-01' }, 30);
  await history.upsertCloseRecord({ ...baseRecord, date: '2026-08-02' }, 30);

  // 构造一个 40 天前的备份文件
  ensureDir(BACKUP_DIR);
  const oldFile = path.join(BACKUP_DIR, '2026.json.2026-06-01T00-00-00-000Z');
  fs.writeFileSync(oldFile, '[]', 'utf8');
  const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldFile, oldTime, oldTime);

  // 构造一个 5 天前的备份文件
  const newFile = path.join(BACKUP_DIR, '2026.json.2026-08-01T00-00-00-000Z');
  fs.writeFileSync(newFile, '[]', 'utf8');
  const newTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  fs.utimesSync(newFile, newTime, newTime);

  console.log('compact 前备份文件:', fs.readdirSync(BACKUP_DIR).length);
  history.compactHistory(30, 30);
  console.log('compact 后备份文件:', fs.readdirSync(BACKUP_DIR));

  // 跑完自动清理测试数据，避免污染真实历史
  try { fs.rmSync(HISTORY_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}
  console.log('测试数据已清理');
})();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
