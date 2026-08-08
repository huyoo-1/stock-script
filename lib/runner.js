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
  const today = todayStr();
  logger.info(`=== 盘中快照 ${today} ${time} ===`);

  // 进度回调：控制台打印抓取进度，便于确认正在抓取
  const onProgress = (p) => {
    const label = p.stage === 'allA' ? '全A股' : p.stage === 'bShare' ? `B股(${p.node})` : p.stage;
    logger.info(`[抓取] ${label}：第 ${p.page} 页，已获取 ${p.got} 只`);
  };

  // 1. 统一抓取市场快照（新浪分页串行 → 东财大包兜底，全A与成分股同源）
  const snap = await em.fetchMarketSnapshot(http, { logger, onProgress });
  if (snap.error || snap.allShares.length === 0) {
    logger.error(`全A行情抓取失败：${snap.error}`);
    await feishu.sendCard(cardBuilder.buildErrorCard({
      date: today, time, reason: snap.error || '全A行情抓取失败',
    })).catch((e) => logger.error('数据异常告警推送失败', e));
    return;
  }
  const allShares = snap.allShares;

  // 2. 广度（A 股 + B 股成交额计入总成交额）
  const bSharesAmount = snap.bShares.reduce((s, r) => s + (r.amount || 0), 0);
  const b = breadth.computeBreadth(allShares);
  const bData = {
    ...b,
    totalAmountYi: Math.round((b.totalAmountYi * 1e8 + bSharesAmount) / 1e8 * 100) / 100,
    tier: breadth.activityTier(b.totalAmountYi + bSharesAmount / 1e8),
  };

  // 3. 拥挤度（同源：全 A + 派生成分股）
  const indices = [];
  for (const [code, name, cons, belongs] of [
    ['000001', '上证指数', snap.shConst, (r) => r.market === 0],
    ['399006', '创业板指', snap.cyConst, (r) => r.code.startsWith('30')],
  ]) {
    const c = crowd.computeCrowding(allShares, cons, config.thresholds, belongs);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote: null });
  }

  // 4. 指数行情（东财单请求，失败降级新浪 hq；避开新浪分页并发，放在分页完成后）
  const [shQuote, cyQuote] = await Promise.all([
    em.fetchIndexQuote(http, '000001', 'SH').catch(() => null),
    em.fetchIndexQuote(http, '399006', 'SZ').catch(() => null),
  ]);
  indices[0].quote = shQuote;
  indices[1].quote = cyQuote;

  // 5. 较上一快照的变化（内存）
  if (!intradayCache.has(today)) intradayCache.set(today, new Map());
  const dayCache = intradayCache.get(today);
  const prevSnapshot = dayCache.size > 0 ? [...dayCache.values()].pop() : null;
  indices.forEach((idx) => {
    const prevIdx = prevSnapshot ? prevSnapshot.indices.find((i) => i.code === idx.code) : null;
    idx.delta = crowd.deltaText(idx.crowding, prevIdx ? prevIdx.crowding : null);
  });

  // 6. 提示
  const tip = buildIntradayTip(indices);

  // 7. 建卡推送
  const card = cardBuilder.buildIntradayCard({ date: today, time, indices, breadth: bData, tip });
  await feishu.sendCard(card);

  // 更新内存缓存
  dayCache.set(time, { indices, breadth: bData });
  logger.info(`盘中快照完成：${indices.map((i) => `${i.name} ${i.crowding}%`).join(' / ')}（${snap.allSource}）`);
}

// 收盘汇总
async function runClose({ config, http, feishu, logger, intradayCache }) {
  const today = todayStr();
  logger.info(`=== 收盘汇总 ${today} ===`);

  history.setLogger(logger);
  const prevClose = history.getPrevClose(today);

  // 进度回调：控制台打印抓取进度
  const onProgress = (p) => {
    const label = p.stage === 'allA' ? '全A股' : p.stage === 'bShare' ? `B股(${p.node})` : p.stage;
    logger.info(`[抓取] ${label}：第 ${p.page} 页，已获取 ${p.got} 只`);
  };

  // 1. 统一抓取市场快照（新浪分页串行 → 东财大包兜底，全A与成分股同源）
  const snap = await em.fetchMarketSnapshot(http, { logger, onProgress });
  if (snap.error || snap.allShares.length === 0) {
    logger.error(`全A行情抓取失败：${snap.error}`);
    await feishu.sendCard(cardBuilder.buildErrorCard({
      date: today, reason: snap.error || '全A行情抓取失败',
    })).catch((e) => logger.error('数据异常告警推送失败', e));
    return;
  }
  const allShares = snap.allShares;

  // 2. 收盘附加数据（东财单请求，与新浪分页不并发）
  const [marginData, etfData, shQuote, cyQuote] = await Promise.all([
    margin.fetchMargin(http, logger),
    etfFlow.fetchEtfFlows(http, config.etfWhitelist, prevClose, config.etfSurgeRatio, logger),
    em.fetchIndexQuote(http, '000001', 'SH').catch(() => null),
    em.fetchIndexQuote(http, '399006', 'SZ').catch(() => null),
  ]);

  // 3. 广度（A 股 + B 股成交额计入总成交额）
  const bSharesAmount = snap.bShares.reduce((s, r) => s + (r.amount || 0), 0);
  const b = breadth.computeBreadth(allShares);
  const bData = {
    ...b,
    totalAmountYi: Math.round((b.totalAmountYi * 1e8 + bSharesAmount) / 1e8 * 100) / 100,
    tier: breadth.activityTier(b.totalAmountYi + bSharesAmount / 1e8),
  };

  // 4. 拥挤度（同源：全 A + 派生成分股）
  const indices = [];
  for (const [code, name, cons, belongs] of [
    ['000001', '上证指数', snap.shConst, (r) => r.market === 0],
    ['399006', '创业板指', snap.cyConst, (r) => r.code.startsWith('30')],
  ]) {
    const c = crowd.computeCrowding(allShares, cons, config.thresholds, belongs);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote: null });
  }
  indices[0].quote = shQuote;
  indices[1].quote = cyQuote;

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
  await history.upsertCloseRecord({
    date: today,
    type: 'close',
    indices: indices.map((i) => ({ code: i.code, name: i.name, crowding: i.crowding, level: i.level })),
    breadth: bData,
    margin: marginFmt,
    etf: etfData,
  }, config.historyDays);

  // 每周五收盘后自动整理历史文件
  const dayOfWeek = new Date().getDay();
  if (config.historyStorage && config.historyStorage.enabled && config.historyStorage.autoCompact && dayOfWeek === 5) {
    logger.info('周五收盘，执行历史数据整理');
    history.compactHistory(config.historyDays, config.historyStorage.backupRetentionDays);
  }

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
