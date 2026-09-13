// 定时器调度：setTimeout 递归（非 setInterval，避免漂移）。
// 锚定绝对时刻（下一个 HH:MM:00），回调内做交易日/时段跳过。
// 睡眠/断电唤醒后，错过的调度点不补跑（A 股盘中数据时效性强，补跑时点错乱无意义），
// 仅记告警日志便于排查。
const calendar = require('./calendar');

// 错过容忍度（毫秒）：回调触发时刻与目标 HH:MM 偏差超过此值视为「错过」，跳过并告警。
// 设 30 分钟：抓取耗时通常 1-2 分钟，睡眠唤醒可能延迟更久。
const MISS_TOLERANCE_MS = 30 * 60 * 1000;

function createScheduler({ config, logger, onIntraday, onClose }) {
  const timers = [];
  let stopped = false;

  function nextDelay(hhmm) {
    const now = new Date();
    const target = calendar.todayAtHHMM(hhmm, now);
    if (target <= now) target.setDate(target.getDate() + 1); // 过了则明天
    return target - now;
  }

  // 判断回调触发时刻是否「错过」目标 HH:MM（偏差超容忍度）
  function isMissed(hhmm) {
    const now = new Date();
    const target = calendar.todayAtHHMM(hhmm, now);
    let diff = now - target;
    if (diff < 0) diff = -diff; // 取绝对值
    return diff > MISS_TOLERANCE_MS;
  }

  function schedulePoint(hhmm, callback, label) {
    const arm = () => {
      if (stopped) return;
      const delay = nextDelay(hhmm);
      const t = setTimeout(async () => {
        // 睡眠/断电唤醒后可能错过该点：偏差超容忍度则跳过并告警，不补跑
        if (isMissed(hhmm)) {
          const now = new Date();
          logger && logger.warn(`错过调度点 ${label}（当前 ${now.toTimeString().slice(0, 5)} 偏差过大，疑似睡眠/断电），跳过本次`);
          arm(); // 重排下一次
          return;
        }
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
