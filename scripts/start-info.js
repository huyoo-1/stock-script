// 启动前信息：读 config.json 的 web 段（不校验飞书，避免 fail-fast）+ 检测局域网 IPv4，
// 在控制台直接打印本机/局域网访问地址。供 run.bat 调用。
// 独立脚本，不依赖 loadConfig（飞书凭证未填也能跑），端口从 config 读，不写死。
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgPath = path.join(__dirname, '..', 'config.json');
let host = '127.0.0.1';
let port = 8787;
try {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (cfg.web) {
    host = cfg.web.host || host;
    port = cfg.web.port || port;
  }
} catch { /* config.json 不存在或非法，用默认值，后续 service.js 会报错 */ }

// 取默认路由出口网卡的 IPv4，避开回环/链路本地/虚拟网卡
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      if (it.family === 'IPv4' && !it.internal && !it.address.startsWith('169.254.')) {
        return it.address;
      }
    }
  }
  return null;
}

const lanIp = getLanIp();
console.log('');
console.log('========================================');
console.log('  A股大盘监控 启动信息');
console.log('========================================');
console.log(`  本机访问：  http://127.0.0.1:${port}`);
if (lanIp) {
  console.log(`  局域网访问：http://${lanIp}:${port}`);
} else {
  console.log('  局域网访问：未检测到可用 IPv4');
}
if (host === '127.0.0.1') {
  console.log('');
  console.log('  [提示] config.web.host=127.0.0.1，仅本机可访问。');
  console.log('         局域网访问需将 config.json 的 web.host 改为 0.0.0.0 后重启。');
}
console.log('========================================');
console.log('');
