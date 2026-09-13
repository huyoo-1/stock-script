// prestart 钩子：dist 缺失时自动构建前端；构建失败或 vite 未安装只提示，不阻断后端启动。
// 常驻监控的稳定性优先于前端构建，前端未构建时面板回落 503 提示页。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const distIndex = path.join(root, 'web', 'dist', 'index.html');

if (fs.existsSync(distIndex)) process.exit(0);

// 探测 vite 是否可用（node_modules 可能只有运行时依赖）
let viteBin = null;
try {
  const p = require.resolve('vite/package.json', { paths: [root] });
  viteBin = path.join(path.dirname(p), 'bin', 'vite.js');
} catch {
  viteBin = null;
}

function hint(msg) {
  console.log('');
  console.log('[prestart] ' + msg);
  console.log('[prestart] 服务将照常启动，Web 面板暂不可用（访问会显示 503 提示页）。');
  console.log('[prestart] 前端构建：npm install && npm run build');
}

if (!viteBin) {
  hint('未检测到 vite（前端构建依赖未安装，可能只装了运行时依赖）。');
  process.exit(0);
}

console.log('[prestart] web/dist 不存在，自动构建前端 ...');
const r = spawnSync(process.execPath, [viteBin, 'build', '--config', 'web/vite.config.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (r.status !== 0) {
  hint('前端构建失败（见上方输出）。');
}
process.exit(0);
