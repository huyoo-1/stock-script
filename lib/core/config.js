// 加载并校验 config.json，缺关键凭证则 fail-fast。
const fs = require('fs');

const DEFAULTS = {
  indices: [
    { name: '上证指数', code: '000001', exchange: 'SH' },
    { name: '创业板指', code: '399006', exchange: 'SZ' },
  ],
  thresholds: { normal: 40, warning: 50 },
  feishu: { appId: '', appSecret: '', chatId: '', domain: 'feishu' },
  mode: 'both',
  intradayPoints: ['10:00', '11:00', '14:00'],
  closeTime: '19:00',
  etfWhitelist: ['510300', '510050', '510500', '510310', '159915'],
  etfSurgeRatio: 2.5,
  marginUnit: '亿元',
  historyDays: 5,
  maxRetries: 3,
  feishuMaxBytes: 20000,
  nid18Enabled: false,
  proxy: null,
  historyStorage: {
    enabled: true,
    dir: 'data/history',
    backupDir: 'data/history_backup',
    autoCompact: true,
    backupRetentionDays: 30,
  },
  web: {
    enabled: true,
    host: '127.0.0.1', // 默认仅本机访问；需远程/局域网访问改 '0.0.0.0'（注意：开放公网有安全风险）
    port: 8787,
  },
  logDir: 'logs', // 日志目录，默认相对项目根目录；可配绝对路径如 /data/log
  logConsoleLevel: 'ERROR', // 控制台日志级别：DEBUG/INFO/WARN/ERROR
  screener: {
    ma20Source: 'auto', // auto=腾讯→新浪; tencent; sina; off=关闭 MA20 精筛
    ma20Days: 20,
    concurrency: 4, // MA20 二次精筛并发数（配合同源随机间隔限速，避免打爆数据源）
    cacheTtlMs: 600000, // 日 K 进程内缓存 10 分钟
    bjCutoff: true, // 北交所日K高频失败时跳过，避免精筛卡住
    bjFailureThreshold: 3, // 最近 N 次北交所请求失败即熔断
    bjWindowSize: 10, // 统计窗口大小
  },
  dataSources: {
    circuitBreaker: { enabled: true, failureThreshold: 3, cooldownMs: 300000 },
  },
  goldStocks: ['600547', '601899', '600489', '002155', '600988', '518880', '159934'],
};

const HHMM = /^\d{2}:\d{2}$/;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function loadConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    throw new Error(`无法读取配置文件 ${configPath}：${e.message}`);
  }

  let user;
  try {
    user = JSON.parse(raw);
  } catch (e) {
    throw new Error(`配置文件 JSON 解析失败：${e.message}`);
  }

  const cfg = mergeDefaults(user);
  const errors = validateConfig(cfg);
  if (errors.length > 0) {
    throw new Error('配置校验失败：\n  - ' + errors.join('\n  - '));
  }

  return Object.freeze(cfg);
}

// 深合并默认值（仅一层对象）
function mergeDefaults(user) {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(user)) {
    if (k === 'feishu' || k === 'thresholds' || k === 'web' || k === 'screener' || k === 'dataSources' || k === 'historyStorage') {
      cfg[k] = { ...cfg[k], ...user[k] };
    } else {
      cfg[k] = user[k];
    }
  }
  return cfg;
}

// 校验已合并默认值的 cfg，返回错误数组（空表示通过）
function validateConfig(cfg) {
  const errors = [];

  if (!Array.isArray(cfg.indices) || cfg.indices.length === 0) {
    errors.push('indices 必须为非空数组');
  } else {
    cfg.indices.forEach((it, i) => {
      if (!it.code || !it.name || !it.exchange) {
        errors.push(`indices[${i}] 缺少 code/name/exchange`);
      }
    });
  }

  if (!(cfg.thresholds.normal < cfg.thresholds.warning)) {
    errors.push('thresholds.normal 必须小于 thresholds.warning');
  }

  const f = cfg.feishu;
  if (!f.appId) errors.push('feishu.appId 不能为空');
  if (!f.appSecret) errors.push('feishu.appSecret 不能为空');
  if (!f.chatId) errors.push('feishu.chatId 不能为空');
  if (f.domain && !['feishu', 'lark'].includes(f.domain)) {
    errors.push('feishu.domain 必须为 feishu 或 lark');
  }

  if (!['intraday', 'close', 'both'].includes(cfg.mode)) {
    errors.push('mode 必须为 intraday/close/both');
  }

  if (!Array.isArray(cfg.intradayPoints) || cfg.intradayPoints.length === 0) {
    errors.push('intradayPoints 必须为非空数组');
  } else {
    cfg.intradayPoints.forEach((p) => {
      if (!HHMM.test(p)) errors.push(`intradayPoints 项 ${p} 不符合 HH:MM`);
      else {
        const min = toMinutes(p);
        if (min < toMinutes('09:30') || min > toMinutes('15:00')) {
          errors.push(`intradayPoints 项 ${p} 超出交易时段 09:30-15:00`);
        }
      }
    });
  }

  if (!HHMM.test(cfg.closeTime)) errors.push('closeTime 不符合 HH:MM');

  if (!Array.isArray(cfg.etfWhitelist)) {
    errors.push('etfWhitelist 必须为数组');
  } else {
    cfg.etfWhitelist.forEach((c) => {
      if (!/^\d{6}$/.test(c)) errors.push(`etfWhitelist 项 ${c} 不是 6 位代码`);
    });
  }

  if (!Array.isArray(cfg.goldStocks)) {
    errors.push('goldStocks 必须为数组');
  } else {
    cfg.goldStocks.forEach((c) => {
      if (!/^\d{6}$/.test(c)) errors.push(`goldStocks 项 ${c} 不是 6 位代码`);
    });
  }

  if (!(cfg.etfSurgeRatio > 1)) errors.push('etfSurgeRatio 必须 > 1');
  if (!(cfg.maxRetries >= 0)) errors.push('maxRetries 必须 >= 0');
  if (!(cfg.historyDays > 0)) errors.push('historyDays 必须 > 0');

  const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  if (cfg.logConsoleLevel && !validLevels.includes(cfg.logConsoleLevel)) {
    errors.push('logConsoleLevel 必须为 DEBUG/INFO/WARN/ERROR 之一');
  }

  if (cfg.historyStorage) {
    if (typeof cfg.historyStorage.enabled !== 'boolean') {
      errors.push('historyStorage.enabled 必须为布尔值');
    }
    if (cfg.historyStorage.backupRetentionDays != null && !(cfg.historyStorage.backupRetentionDays > 0)) {
      errors.push('historyStorage.backupRetentionDays 必须 > 0');
    }
  }

  if (cfg.web) {
    if (typeof cfg.web.enabled !== 'boolean') {
      errors.push('web.enabled 必须为布尔值');
    }
    if (typeof cfg.web.host !== 'string' || !cfg.web.host) {
      errors.push('web.host 不能为空');
    }
    if (!Number.isInteger(cfg.web.port) || cfg.web.port < 1 || cfg.web.port > 65535) {
      errors.push('web.port 必须为 1-65535 的整数');
    }
  }

  if (cfg.screener) {
    if (!['auto', 'tencent', 'sina', 'off'].includes(cfg.screener.ma20Source)) {
      errors.push('screener.ma20Source 必须为 auto/tencent/sina/off');
    }
    if (!(cfg.screener.ma20Days >= 20)) {
      errors.push('screener.ma20Days 必须 >= 20');
    }
    if (!(cfg.screener.concurrency >= 1)) {
      errors.push('screener.concurrency 必须 >= 1');
    }
    if (!(cfg.screener.cacheTtlMs >= 0)) {
      errors.push('screener.cacheTtlMs 必须 >= 0');
    }
    if (cfg.screener.bjCutoff != null && typeof cfg.screener.bjCutoff !== 'boolean') {
      errors.push('screener.bjCutoff 必须为布尔值');
    }
    if (cfg.screener.bjFailureThreshold != null && !(cfg.screener.bjFailureThreshold >= 1)) {
      errors.push('screener.bjFailureThreshold 必须 >= 1');
    }
    if (cfg.screener.bjWindowSize != null && !(cfg.screener.bjWindowSize >= 1)) {
      errors.push('screener.bjWindowSize 必须 >= 1');
    }
  }

  if (cfg.dataSources) {
    if (cfg.dataSources.circuitBreaker) {
      if (typeof cfg.dataSources.circuitBreaker.enabled !== 'boolean') {
        errors.push('dataSources.circuitBreaker.enabled 必须为布尔值');
      }
      if (!(cfg.dataSources.circuitBreaker.failureThreshold >= 1)) {
        errors.push('dataSources.circuitBreaker.failureThreshold 必须 >= 1');
      }
      if (!(cfg.dataSources.circuitBreaker.cooldownMs >= 0)) {
        errors.push('dataSources.circuitBreaker.cooldownMs 必须 >= 0');
      }
    }
  }

  return errors;
}

// 原子写 config.json（.tmp + rename）
function saveConfig(configPath, cfg) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configPath);
}

module.exports = { loadConfig, saveConfig, mergeDefaults, validateConfig, DEFAULTS };
