// 双输出（文件 + 控制台）日志，按大小轮转，零外部依赖。
// 文件侧默认记录 INFO 及以上到 index.log；ERROR 额外写入 error.log。
// 控制台侧默认只输出 ERROR，可通过 config.logConsoleLevel 调整。
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 10 * 1024 * 1024; // 10MB 轮转

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = { DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };

function ts() {
  return new Date().toISOString();
}

function levelValue(level) {
  return LEVELS[level] != null ? LEVELS[level] : LEVELS.INFO;
}

function createLogger(logDir, { consoleLevel = 'ERROR', fileLevel = 'INFO' } = {}) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const indexPath = path.join(logDir, 'index.log');
  const errPath = path.join(logDir, 'error.log');

  let indexStream = fs.createWriteStream(indexPath, { flags: 'a' });
  let errStream = fs.createWriteStream(errPath, { flags: 'a' });

  const consoleThreshold = levelValue(consoleLevel);
  const fileThreshold = levelValue(fileLevel);

  // 轮转：超 MAX_BYTES 则 end 旧流、rename、开新流。
  // 返回新流并更新闭包变量，避免轮转后 'write after end'。
  function rotate(getStream, setStream, file) {
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        const old = getStream();
        old.end();
        fs.renameSync(file, file + '.1');
        const next = fs.createWriteStream(file, { flags: 'a' });
        setStream(next);
        return next;
      }
    } catch {
      // 文件可能尚未创建，忽略
    }
    return getStream();
  }

  function write(level, msg, extra) {
    const line = `[${ts()}] ${level} ${msg}${extra !== undefined ? ' ' + (extra instanceof Error ? extra.stack : JSON.stringify(extra)) : ''}\n`;
    const lv = levelValue(level);

    // 文件侧：按 fileLevel 过滤；ERROR 额外进 error.log
    if (lv >= fileThreshold) {
      indexStream = rotate(() => indexStream, (s) => { indexStream = s; }, indexPath);
      indexStream.write(line);
      if (level === 'ERROR') {
        errStream = rotate(() => errStream, (s) => { errStream = s; }, errPath);
        errStream.write(line);
      }
    }

    // 控制台侧：按 consoleLevel 过滤
    if (lv >= consoleThreshold) {
      process.stdout.write(`${COLORS[level] || ''}${line}\x1b[0m`);
    }
  }

  return {
    debug: (msg, extra) => write('DEBUG', msg, extra),
    info: (msg, extra) => write('INFO', msg, extra),
    warn: (msg, extra) => write('WARN', msg, extra),
    error: (msg, extra) => write('ERROR', msg, extra),
  };
}

module.exports = { createLogger };
