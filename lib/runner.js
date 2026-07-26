// 编排：runIntraday（盘中快照）/ runClose（收盘汇总）调用各模块。
const em = require('./emData');
const breadth = require('./breadth');
const crowd = require('./crowd');
const margin = require('./margin');
const etfFlow = require('./etfFlow');
const history = require('./history');
const cardBuilder = require('./cardBuilder');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 盘中快照
async function runIntraday({ config, http, feishu, logger, intradayCache, time }) {
  logger.info(`=== 盘中快照 ${todayStr()} ${time} ===`);

  // 并行：全 A（广度）+ 两指数成分股（拥挤度）+ 两指数行情
  const [allShares, shConst, cyConst, shQuote, cyQuote] = await Promise.all([
    em.fetchAllAShares(http).catch((e) => { logger.error('全 A 拉取失败', e); return []; }),
    em.fetchIndexConstituents(http, '000001').catch((e) => { logger.error('上证成分股失败', e); return { rows: [], source: 'none' }; }),
    em.fetchIndexConstituents(http, '399006').catch((e) => { logger.error('创业板成分股失败', e); return { rows: [], source: 'none' }; }),
    em.fetchIndexQuote(http, '000001', 'SH').catch(() => null),
    em.fetchIndexQuote(http, '399006', 'SZ').catch(() => null),
  ]);

  // 广度
  const b = breadth.computeBreadth(allShares);
  const bData = { ...b, tier: breadth.activityTier(b.totalAmountYi) };

  // 拥挤度
  const indices = [];
  for (const [code, name, cons, quote] of [
    ['000001', '上证指数', shConst, shQuote],
    ['399006', '创业板指', cyConst, cyQuote],
  ]) {
    const c = crowd.computeCrowding(cons.rows, config.thresholds);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote });
  }

  // 较上一快照的变化（内存）
  const today = todayStr();
  if (!intradayCache.has(today)) intradayCache.set(today, new Map());
  const dayCache = intradayCache.get(today);
  const prevSnapshot = dayCache.size > 0 ? [...dayCache.values()].pop() : null;
  indices.forEach((idx) => {
    const prevIdx = prevSnapshot ? prevSnapshot.indices.find((i) => i.code === idx.code) : null;
    idx.delta = crowd.deltaText(idx.crowding, prevIdx ? prevIdx.crowding : null);
  });

  // 提示
  const tip = buildIntradayTip(indices);

  // 建卡推送
  const card = cardBuilder.buildIntradayCard({ date: today, time, indices, breadth: bData, tip });
  await feishu.sendCard(card);

  // 更新内存缓存
  dayCache.set(time, { indices, breadth: bData });
  logger.info(`盘中快照完成：${indices.map((i) => `${i.name} ${i.crowding}%`).join(' / ')}`);
}

// 收盘汇总
async function runClose({ config, http, feishu, logger, intradayCache }) {
  const today = todayStr();
  logger.info(`=== 收盘汇总 ${today} ===`);

  const prevClose = history.getPrevClose(today);

  // 并行拉取全部数据
  const [allShares, shConst, cyConst, shQuote, cyQuote, marginData, etfData] = await Promise.all([
    em.fetchAllAShares(http).catch((e) => { logger.error('全 A 拉取失败', e); return []; }),
    em.fetchIndexConstituents(http, '000001').catch((e) => { logger.error('上证成分股失败', e); return { rows: [], source: 'none' }; }),
    em.fetchIndexConstituents(http, '399006').catch((e) => { logger.error('创业板成分股失败', e); return { rows: [], source: 'none' }; }),
    em.fetchIndexQuote(http, '000001', 'SH').catch(() => null),
    em.fetchIndexQuote(http, '399006', 'SZ').catch(() => null),
    margin.fetchMargin(http, logger),
    etfFlow.fetchEtfFlows(http, config.etfWhitelist, prevClose, config.etfSurgeRatio, logger),
  ]);

  // 广度
  const b = breadth.computeBreadth(allShares);
  const bData = { ...b, tier: breadth.activityTier(b.totalAmountYi) };

  // 拥挤度
  const indices = [];
  for (const [code, name, cons, quote] of [
    ['000001', '上证指数', shConst, shQuote],
    ['399006', '创业板指', cyConst, cyQuote],
  ]) {
    const c = crowd.computeCrowding(cons.rows, config.thresholds);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote });
  }

  // 融资融券（含变动）
  const marginFmt = margin.formatMargin(marginData, prevClose && prevClose.margin);

  // 近 30 日历史
  const history30 = history.getRecentClose(config.historyDays);

  // 结论
  const conclusion = buildCloseConclusion(indices, marginFmt, etfData, bData);

  // 建卡（可能拆分）推送
  const card = cardBuilder.buildCloseCard({
    date: today, indices, breadth: bData, margin: marginFmt, etf: etfData, history30, conclusion,
  });
  const cards = cardBuilder.maybeChunk(card, config.feishuMaxBytes);
  await feishu.sendCards(cards);

  // 写收盘记录
  history.upsertCloseRecord({
    date: today,
    type: 'close',
    indices: indices.map((i) => ({ code: i.code, name: i.name, crowding: i.crowding, level: i.level })),
    breadth: bData,
    margin: marginFmt,
    etf: etfData,
  }, config.historyDays);

  logger.info('收盘汇总完成');
}

function buildIntradayTip(indices) {
  const warnings = indices.filter((i) => i.level === 'warning');
  const watches = indices.filter((i) => i.level === 'watch');
  if (warnings.length > 0) {
    return `${warnings.map((i) => i.name).join('、')}进入预警区，头部交易集中度偏高，留意后续反转或风格切换风险。`;
  }
  if (watches.length > 0) {
    return `${watches.map((i) => i.name).join('、')}进入关注区，交易集中度上升，关注后续变化。`;
  }
  return '各指数拥挤度处于正常区间，市场交易分散。';
}

function buildCloseConclusion(indices, marginFmt, etfData, bData) {
  const parts = [];
  const warn = indices.filter((i) => i.level !== 'normal');
  if (warn.length > 0) {
    parts.push(`${warn.map((i) => `${i.name}${crowd.LEVEL_LABEL[i.level]}`).join('、')}`);
  }
  if (marginFmt && !marginFmt.error) {
    const dir = marginFmt.totalDelta > 0 ? '净流入' : marginFmt.totalDelta < 0 ? '净流出' : '持平';
    parts.push(`融资融券合计${dir}，杠杆情绪${marginFmt.totalDelta > 0 ? '偏暖' : marginFmt.totalDelta < 0 ? '偏冷' : '平稳'}`);
  }
  const surge = etfData.filter((e) => e.tag === '疑似国家队');
  if (surge.length > 0) {
    parts.push(`${surge.map((e) => e.code).join('、')}成交额放大，疑似国家队入场`);
  }
  parts.push(`两市成交 ${bData.totalAmountYi} 亿（${bData.tier}）`);
  return parts.join('；') + '。';
}

module.exports = { runIntraday, runClose };
