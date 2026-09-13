// 编排：runIntraday（盘中快照）/ runClose（收盘汇总）调用各模块。
// 数据抓取统一走 fetcherMgr（策略模式：按 capability 路由 + 自动 failover + 熔断）。
const em = require('./emData');
const breadth = require('./algo/breadth');
const crowd = require('./algo/crowd');
const { formatMargin } = require('./margin');
const etfFlow = require('./etfFlow');
const history = require('./store/history');
const priceHistory = require('./store/priceHistory');
const goldHistory = require('./store/goldHistory');
const screener = require('./algo/screener');
const cardBuilder = require('./view/cardBuilder');
const { createMa20Provider } = require('./kline');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 全A行情（含 B 股 + 派生成分股）
async function fetchAllShares(fetcherMgr, http, logger, onProgress) {
  const { result, source } = await fetcherMgr.execute(http, { onProgress }, {
    capability: 'allA',
    validate: (rows) => rows.length >= 3000,
  });
  if (!result) return { allShares: [], source: null, error: '全A行情抓取失败' };
  const allShares = result;
  const shConst = em.deriveConstituents(allShares, '000001');
  const cyConst = em.deriveConstituents(allShares, '399006');
  let bShares = [];
  try { bShares = await em.fetchBShares(http, { onProgress }); } catch (e) { logger.warn('B股成交额抓取失败（忽略）', e.message); }
  return { allShares, source, shConst, cyConst, bShares };
}

// 指数行情
async function fetchIndexQuote(fetcherMgr, http, code, exchange) {
  const { result } = await fetcherMgr.execute(http, { code, exchange }, { capability: 'indexQuote' });
  return result;
}

// ETF 行情
async function fetchEtfQuote(fetcherMgr, http, code) {
  const { result } = await fetcherMgr.execute(http, { code }, { capability: 'etfQuote' });
  return result;
}

// 融资融券
async function fetchMarginData(fetcherMgr, http, logger) {
  const { result, error } = await fetcherMgr.execute(http, {}, { capability: 'margin' });
  if (error) {
    logger.warn('融资融券(manager):', error);
    return { error: '融资融券数据获取失败', source: 'none' };
  }
  return result;
}

// 盘中快照
async function runIntraday({ config, http, fetcherMgr, feishu, logger, intradayCache, time }) {
  const today = todayStr();
  logger.info(`=== 盘中快照 ${today} ${time} ===`);

  // 进度回调：控制台打印抓取进度
  const onProgress = (p) => {
    const label = p.stage === 'allA' ? '全A股' : p.stage === 'bShare' ? `B股(${p.node})` : p.stage;
    logger.info(`[抓取] ${label}：第 ${p.page} 页，已获取 ${p.got} 只`);
  };

  // 1. 全A行情
  const res = await fetchAllShares(fetcherMgr, http, logger, onProgress);
  if (res.error) {
    logger.error(res.error);
    feishu.sendCard(cardBuilder.buildErrorCard({
      date: today, time, reason: res.error,
    })).catch((e) => logger.error('数据异常告警推送失败', e));
    return;
  }
  const { allShares, source, shConst, cyConst, bShares } = res;

  // 2. 广度（A 股 + B 股成交额计入总成交额）
  const bSharesAmount = bShares.reduce((s, r) => s + (r.amount || 0), 0);
  const b = breadth.computeBreadth(allShares);
  const bData = {
    ...b,
    totalAmountYi: Math.round((b.totalAmountYi * 1e8 + bSharesAmount) / 1e8 * 100) / 100,
    tier: breadth.activityTier(b.totalAmountYi + bSharesAmount / 1e8),
  };

  // 3. 拥挤度（同源：全 A + 派生成分股）
  const indices = [];
  for (const [code, name, cons, belongs] of [
    ['000001', '上证指数', shConst, (r) => r.market === 0],
    ['399006', '创业板指', cyConst, (r) => r.code.startsWith('30')],
  ]) {
    const c = crowd.computeCrowding(allShares, cons, config.thresholds, belongs);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote: null });
  }

  // 4. 指数行情
  const [shQuote, cyQuote] = await Promise.all([
    fetchIndexQuote(fetcherMgr, http, '000001', 'SH'),
    fetchIndexQuote(fetcherMgr, http, '399006', 'SZ'),
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
  feishu.sendCard(card).catch((e) => logger.error('盘中卡片推送失败', e));

  // 更新内存缓存
  dayCache.set(time, { indices, breadth: bData });

  // 落盘
  try {
    history.upsertIntradayRecord({
      date: today, time,
      indices: indices.map((i) => ({
        code: i.code, name: i.name, crowding: i.crowding, level: i.level,
        quote: i.quote, delta: i.delta,
      })),
      breadth: bData, tip,
    });
  } catch (e) {
    logger.error('盘中快照落盘失败', e);
  }

  logger.info(`盘中快照完成：${indices.map((i) => `${i.name} ${i.crowding}%`).join(' / ')}（${source}）`);
}

// 收盘汇总
async function runClose({ config, http, fetcherMgr, feishu, logger, intradayCache, ma20Provider }) {
  const today = todayStr();
  logger.info(`=== 收盘汇总 ${today} ===`);
  const calendar = require('./core/calendar');
  if (!calendar.isTradingDay(new Date())) {
    const reason = `${today} 为非交易日，跳过收盘汇总`;
    logger.warn(reason);
    return { skipped: true, reason };
  }
  const ma20 = ma20Provider || createMa20Provider({ http, config, logger, fetcherMgr });

  history.setLogger(logger);
  const prevClose = history.getPrevClose(today);

  // 进度回调
  const onProgress = (p) => {
    const label = p.stage === 'allA' ? '全A股' : p.stage === 'bShare' ? `B股(${p.node})` : p.stage;
    logger.info(`[抓取] ${label}：第 ${p.page} 页，已获取 ${p.got} 只`);
  };

  // 1. 全A行情
  const res = await fetchAllShares(fetcherMgr, http, logger, onProgress);
  if (res.error) {
    logger.error(res.error);
    feishu.sendCard(cardBuilder.buildErrorCard({
      date: today, reason: res.error,
    })).catch((e) => logger.error('数据异常告警推送失败', e));
    return;
  }
  const { allShares, source, shConst, cyConst, bShares } = res;

  // 2. 收盘附加数据（allSettled 容错：任一失败降级为空值，不中断整个收盘流程）
  const [marginR, etfR, shR, cyR] = await Promise.allSettled([
    fetchMarginData(fetcherMgr, http, logger),
    etfFlow.fetchEtfFlows(http, config.etfWhitelist, prevClose, config.etfSurgeRatio, logger, (code) => fetchEtfQuote(fetcherMgr, http, code)),
    fetchIndexQuote(fetcherMgr, http, '000001', 'SH'),
    fetchIndexQuote(fetcherMgr, http, '399006', 'SZ'),
  ]);
  const marginData = marginR.status === 'fulfilled' ? marginR.value : { error: '融资融券抓取失败', source: 'none' };
  const etfData = etfR.status === 'fulfilled' ? etfR.value : [];
  const shQuote = shR.status === 'fulfilled' ? shR.value : null;
  const cyQuote = cyR.status === 'fulfilled' ? cyR.value : null;
  if (marginR.status === 'rejected') logger.warn('融资融券抓取异常', marginR.reason && marginR.reason.message);
  if (etfR.status === 'rejected') logger.warn('ETF 抓取异常', etfR.reason && etfR.reason.message);
  if (shR.status === 'rejected') logger.warn('上证行情抓取异常', shR.reason && shR.reason.message);
  if (cyR.status === 'rejected') logger.warn('创业板行情抓取异常', cyR.reason && cyR.reason.message);

  // 3. 广度
  const bSharesAmount = bShares.reduce((s, r) => s + (r.amount || 0), 0);
  const b = breadth.computeBreadth(allShares);
  const bData = {
    ...b,
    totalAmountYi: Math.round((b.totalAmountYi * 1e8 + bSharesAmount) / 1e8 * 100) / 100,
    tier: breadth.activityTier(b.totalAmountYi + bSharesAmount / 1e8),
  };

  // 4. 拥挤度
  const indices = [];
  for (const [code, name, cons, belongs] of [
    ['000001', '上证指数', shConst, (r) => r.market === 0],
    ['399006', '创业板指', cyConst, (r) => r.code.startsWith('30')],
  ]) {
    const c = crowd.computeCrowding(allShares, cons, config.thresholds, belongs);
    indices.push({ code, name, crowding: c.crowding, level: c.level, quote: null });
  }
  indices[0].quote = shQuote;
  indices[1].quote = cyQuote;

  // 融资融券（含变动）
  const marginFmt = formatMargin(marginData, prevClose && prevClose.margin);

  // 近 30 日历史
  const history30 = history.getRecentClose(config.historyDays);

  // 核心收盘记录先落盘（拥挤度/广度/margin/etf），保证抓取成功即写入，
  // 后续技术筛选若失败也不致当日收盘记录永久缺失
  await history.upsertCloseRecord({
    date: today,
    type: 'close',
    indices: indices.map((i) => ({ code: i.code, name: i.name, crowding: i.crowding, level: i.level })),
    breadth: bData,
    margin: marginFmt,
    etf: etfData,
  }, config.historyDays);

  // 技术筛选（附加数据，失败只 warn 不影响核心记录与推送）
  let screenSummary = { count: 0, candidates: 0, readyDays: 0, neededDays: screener.MA10_DAYS };
  try {
    priceHistory.setLogger(logger);
    priceHistory.saveDaySnapshot(today, allShares);

    // 黄金数据落盘（附加数据，失败只 warn 不影响核心记录与推送）
    try {
      goldHistory.setLogger(logger);
      // goldStocks 可能混有黄金股与黄金 ETF：A 股从全 A 快照取，ETF 单独拉行情
      const goldEntries = await Promise.all((config.goldStocks || []).map(async (code) => {
        const stock = allShares.find((r) => r.code === code);
        if (stock) return { code: stock.code, name: stock.name, close: stock.price, chgPct: stock.chgPct };
        try {
          const q = await fetchEtfQuote(fetcherMgr, http, code);
          if (q) return { code, name: q.name || code, close: q.price, chgPct: q.chgPct };
        } catch (e) { logger.warn(`黄金ETF ${code} 行情获取失败`, e.message); }
        return null;
      }));
      const goldStocks = goldEntries.filter(Boolean);
      const goldR = await fetcherMgr.execute(http, { contract: 'hf_XAU' }, { capability: 'goldPrice' });
      const goldPrice = goldR.result;
      if (goldPrice || goldStocks.length > 0) {
        goldHistory.saveGoldSnapshot(today, { goldPrice, stocks: goldStocks });
        logger.info(`黄金数据落盘：金价 ${goldPrice ? goldPrice.price : '缺失'}，黄金股/ETF ${goldStocks.length} 只`);
      }
    } catch (e) {
      logger.error('黄金数据落盘失败（忽略）', e);
    }

    const recent = priceHistory.loadRecentDays(screener.MA10_DAYS);
    const screenCandidates = screener.runScreener(recent);
    let screenResults = screenCandidates;
    screenSummary = {
      count: screenCandidates.length,
      candidates: screenCandidates.length,
      readyDays: screener.readyDays(recent),
      neededDays: screener.MA10_DAYS,
      upDays: screener.UP_DAYS,
    };
    if (ma20.enabled) {
      const refined = await screener.applyMa20Filter(screenCandidates, ma20.fetch, {
        concurrency: ma20.concurrency,
        logger,
      });
      screenResults = refined.items;
      screenSummary.count = screenResults.length;
      screenSummary.checked = refined.checked;
      screenSummary.ma20Missing = refined.missing.length;
      screenSummary.ma20Source = ma20.source;
      logger.info(`技术筛选：本地粗筛 ${screenCandidates.length} 只 → MA20 精筛 ${screenResults.length} 只（数据 ${screenSummary.readyDays}/${screenSummary.neededDays} 个交易日）`);
    } else {
      logger.info(`技术筛选：${screenResults.length} 只（未启用 MA20 精筛，数据 ${screenSummary.readyDays}/${screenSummary.neededDays} 个交易日）`);
    }

    // 精筛结果落盘：Web 面板直接读，避免每次访问重算日K
    priceHistory.saveScreenerResult({
      ...screenSummary,
      items: screenResults,
      updatedAt: today,
    });
  } catch (e) {
    logger.error('技术筛选失败（忽略，核心收盘记录已落盘）', e);
  }

  // 结论
  const conclusion = buildCloseConclusion(indices, marginFmt, etfData, bData);

  // 建卡推送
  const card = cardBuilder.buildCloseCard({
    date: today, indices, breadth: bData, margin: marginFmt, etf: etfData, history30, conclusion, screenSummary,
  });
  const cards = cardBuilder.maybeChunk(card, config.feishuMaxBytes);
  feishu.sendCards(cards).catch((e) => logger.error('收盘卡片推送失败', e));

  // 每周五收盘后自动整理
  const dayOfWeek = new Date().getDay();
  if (config.historyStorage && config.historyStorage.enabled && config.historyStorage.autoCompact && dayOfWeek === 5) {
    logger.info('周五收盘，执行历史数据整理');
    history.compactHistory(config.historyDays, config.historyStorage.backupRetentionDays);
  }

  try { history.pruneIntraday(2); } catch (e) { logger.error('盘中快照清理失败', e); }

  logger.info(`收盘汇总完成（${source}）`);
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
