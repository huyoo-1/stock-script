// 双输出（stdout + 文件）日志，按大小轮转，零外部依赖。
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 10 * 1024 * 1024; // 10MB 轮转

function ts() {
  return new Date().toISOString();
}

function createLogger(logDir) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const runPath = path.join(logDir, 'run.log');
  const errPath = path.join(logDir, 'error.log');

  let runStream = fs.createWriteStream(runPath, { flags: 'a' });
  let errStream = fs.createWriteStream(errPath, { flags: 'a' });

  // 轮转：超 MAX_BYTES 则 end 旧流、rename、开新流。
  // 返回新流并更新闭包变量（旧实现把新流赋给函数参数，闭包外的 runStream/errStream 永不更新，
  // 轮转后旧流已 end，后续 write 抛 'write after end'，日志全部丢失）。
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
    runStream = rotate(() => runStream, (s) => { runStream = s; }, runPath);
    const line = `[${ts()}] ${level} ${msg}${extra !== undefined ? ' ' + (extra instanceof Error ? extra.stack : JSON.stringify(extra)) : ''}\n`;
    runStream.write(line);
    // run.log 与 stdout 同步；error 额外进 error.log
    if (level === 'ERROR') {
      errStream = rotate(() => errStream, (s) => { errStream = s; }, errPath);
      errStream.write(line);
    }
    // stdout 着色
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
    process.stdout.write(`${color}${line}\x1b[0m`);
  }

  return {
    info: (msg, extra) => write('INFO', msg, extra),
    warn: (msg, extra) => write('WARN', msg, extra),
    error: (msg, extra) => write('ERROR', msg, extra),
  };
}

module.exports = { createLogger };
