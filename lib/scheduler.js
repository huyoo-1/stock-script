// 定时器调度：setTimeout 递归（非 setInterval，避免漂移）。
// 盘中点 + 收盘点各一个 timer，回调内做交易日/时段跳过。
const calendar = require('./calendar');

function createScheduler({ config, logger, onIntraday, onClose }) {
  const timers = [];
  let stopped = false;

  function nextDelay(hhmm) {
    const now = new Date();
    const target = calendar.todayAtHHMM(hhmm, now);
    if (target <= now) target.setDate(target.getDate() + 1); // 过了则明天
    return target - now;
  }

  function schedulePoint(hhmm, callback, label) {
    const arm = () => {
      if (stopped) return;
      const delay = nextDelay(hhmm);
      const t = setTimeout(async () => {
        try {
          await callback();
        } catch (e) {
          logger && logger.error(`${label} 执行异常`, e);
        }
        arm(); // 递归重排
      }, delay);
      timers.push(t);
    };
    arm();
  }

  function start() {
    // 盘中快照点
    if (config.mode === 'intraday' || config.mode === 'both') {
      for (const hhmm of config.intradayPoints) {
        schedulePoint(hhmm, async () => {
          const now = new Date();
          if (!calendar.isTradingDay(now)) {
            logger && logger.info(`非交易日，跳过盘中 ${hhmm}`);
            return;
          }
          if (!calendar.isTradingHour(now)) {
            logger && logger.info(`非交易时段，跳过盘中 ${hhmm}`);
            return;
          }
          await onIntraday(hhmm);
        }, `intraday:${hhmm}`);
      }
    }

    // 收盘汇总
    if (config.mode === 'close' || config.mode === 'both') {
      schedulePoint(config.closeTime, async () => {
        const now = new Date();
        if (!calendar.isTradingDay(now)) {
          logger && logger.info(`非交易日，跳过收盘汇总`);
          return;
        }
        await onClose();
      }, `close:${config.closeTime}`);
    }

    logger && logger.info(`调度已启动：盘中 ${config.intradayPoints.join('/')}，收盘 ${config.closeTime}`);
  }

  function stop() {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    logger && logger.info('调度已停止');
  }

  return { start, stop };
}

module.exports = { createScheduler };
