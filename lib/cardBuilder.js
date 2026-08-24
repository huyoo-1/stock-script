// 飞书消息卡片 JSON 组装：lark_md 不支持表格，用 column_set + column 画真表格。
// 纯函数，无 I/O。
const crowd = require('./crowd');

// 辅助：lark_md 文本块
function md(text) {
  return { tag: 'div', text: { tag: 'lark_md', content: text } };
}

// 辅助：分割线
function hr() {
  return { tag: 'hr' };
}

// 辅助：多列布局（columns 为 [{ weight, lines: [str] }]）
function columnSet(columns) {
  return {
    tag: 'column_set',
    columns: columns.map((c) => ({
      tag: 'column',
      width: 'weighted',
      weight: c.weight || 1,
      elements: [md(c.lines.join('\n'))],
    })),
  };
}

// 拥挤度行文本
function crowdingLine(idx) {
  const emoji = crowd.LEVEL_EMOJI[idx.level] || '';
  const label = crowd.LEVEL_LABEL[idx.level] || '';
  const delta = idx.delta ? ` (较上一快照 ${idx.delta})` : '';
  return `**${idx.name}**：${idx.crowding != null ? idx.crowding.toFixed(2) + '%' : '—'}  ${emoji} ${label}${delta}`;
}

// 广度三列
function breadthColumns(b) {
  return columnSet([
    { weight: 1, lines: [`**涨/跌/平**`, `${b.up} / ${b.down} / ${b.flat}`] },
    { weight: 1, lines: [`**涨停/跌停**`, `${b.limitUp} / ${b.limitDown}`] },
    { weight: 1, lines: [`**两市成交**`, `${b.totalAmountYi} 亿`, `(${b.tier})`] },
  ]);
}

// 盘中快照卡片
function buildIntradayCard({ date, time, indices, breadth, tip }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `A股大盘拥挤度监控·盘中 ${date} ${time}` },
    },
    elements: [
      md(indices.map(crowdingLine).join('\n')),
      hr(),
      md('**市场广度**'),
      breadthColumns(breadth),
      hr(),
      md(tip || ''),
    ].filter((e) => !(e.tag === 'div' && !e.text.content)),
  };
}

// 收盘汇总卡片（含融资表/ETF 表/30 日表）
function buildCloseCard({ date, indices, breadth, margin, etf, history30, conclusion, screenSummary }) {
  const elements = [];

  // 拥挤度
  elements.push(md(indices.map(crowdingLine).join('\n')));
  elements.push(hr());

  // 广度
  elements.push(md('**市场广度**'));
  elements.push(breadthColumns(breadth));
  elements.push(hr());

  // 融资融券（3 列：融资/融券/合计，每列含值+变动）
  if (margin && !margin.error) {
    elements.push(md('**融资融券余额（亿元）**'));
    elements.push(columnSet([
      { weight: 1, lines: ['**融资余额**', String(margin.fin), deltaStr(margin.finDelta)] },
      { weight: 1, lines: ['**融券余额**', String(margin.loan), deltaStr(margin.loanDelta)] },
      { weight: 1, lines: ['**合计**', String(margin.total), deltaStr(margin.totalDelta)] },
    ]));
    elements.push(hr());
  } else if (margin && margin.error) {
    elements.push(md(`**融资融券**：${margin.error}`));
    elements.push(hr());
  }

  // ETF 异动表（每行一个 column_set）
  if (etf && etf.length > 0) {
    elements.push(md('**宽基 ETF 成交额异动**'));
    // 表头行
    elements.push(columnSet([
      { weight: 2, lines: ['**ETF**'] },
      { weight: 1, lines: ['**当日额(亿)**'] },
      { weight: 1, lines: ['**倍数**'] },
      { weight: 1, lines: ['**标记**'] },
    ]));
    for (const e of etf) {
      elements.push(columnSet([
        { weight: 2, lines: [`${e.code} ${e.name || ''}`] },
        { weight: 1, lines: [e.todayAmountYi != null ? String(e.todayAmountYi) : '—'] },
        { weight: 1, lines: [e.surge != null ? e.surge + 'x' : '—'] },
        { weight: 1, lines: [e.tag] },
      ]));
    }
    elements.push(hr());
  }

  // 近 30 日拥挤度对比（每行一个 column_set）
  if (history30 && history30.length > 0) {
    elements.push(md('**近 5 日拥挤度对比**'));
    elements.push(columnSet([
      { weight: 1, lines: ['**日期**'] },
      { weight: 1, lines: ['**上证**'] },
      { weight: 1, lines: ['**创业**'] },
    ]));
    for (const rec of history30) {
      const sh = rec.indices.find((i) => i.code === '000001');
      const cy = rec.indices.find((i) => i.code === '399006');
      elements.push(columnSet([
        { weight: 1, lines: [rec.date.slice(5)] }, // MM-DD
        { weight: 1, lines: [sh ? sh.crowding.toFixed(2) + '%' : '—'] },
        { weight: 1, lines: [cy ? cy.crowding.toFixed(2) + '%' : '—'] },
      ]));
    }
    elements.push(hr());
  }

  // 技术筛选汇总（仅总数，明细供 Web 面板查看）
  if (screenSummary) {
    const ready = screenSummary.readyDays;
    const need = screenSummary.neededDays;
    const line = ready >= need
      ? `技术筛选：**${screenSummary.count} 只**（连续3日上涨 且 现价≥MA5/MA20，MA5>MA10>MA20，明细见 Web 面板）`
      : `技术筛选：数据积累中（${ready}/${need} 个交易日）`;
    elements.push(hr());
    elements.push(md(line));
  }

  // 结论
  if (conclusion) elements.push(md(conclusion));

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `A股大盘拥挤度监控 ${date}` },
    },
    elements,
  };
}

function deltaStr(delta) {
  if (delta == null) return '';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}`;
}

// 数据异常告警卡片（全 A 抓取失败时推送，避免推送全 0/未知数据）
function buildErrorCard({ date, time, reason }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `A股大盘拥挤度监控·数据异常 ${date}${time ? ` ${time}` : ''}` },
    },
    elements: [
      md('**数据抓取失败**'),
      md(reason || '未知错误'),
      hr(),
      md('请检查网络 / 数据源状态，本时段数据已标记为缺失，不推送统计结果。'),
    ],
  };
}

// 超过 feishuMaxBytes 则拆分（收盘卡片可能很长）
function maybeChunk(card, maxBytes) {
  const json = JSON.stringify(card);
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return [card];
  // 简单拆分：把 elements 按顺序切分到多个卡片
  const chunks = [];
  let cur = { ...card, elements: [] };
  let curSize = Buffer.byteLength(JSON.stringify({ config: card.config, header: card.header }), 'utf8');
  for (const el of card.elements) {
    const elSize = Buffer.byteLength(JSON.stringify(el), 'utf8');
    if (curSize + elSize > maxBytes && cur.elements.length > 0) {
      chunks.push(cur);
      cur = { ...card, header: { ...card.header, title: { ...card.header.title, content: card.header.title.content + '（续）' } }, elements: [] };
      curSize = Buffer.byteLength(JSON.stringify({ config: card.config, header: cur.header }), 'utf8');
    }
    cur.elements.push(el);
    curSize += elSize;
  }
  if (cur.elements.length > 0) chunks.push(cur);
  return chunks;
}

module.exports = { buildIntradayCard, buildCloseCard, buildErrorCard, maybeChunk, md, hr, columnSet };
