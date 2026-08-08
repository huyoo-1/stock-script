// 融资融券余额：东财主源 + 上交所/深交所备选校验。
const em = require('./emData');

// 拉取融资融券余额（亿元）
async function fetchMargin(http, logger) {
  // 主源：东财 datacenter
  try {
    const r = await em.fetchMarginBalance(http);
    if (r && r.finBalance != null && r.loanBalance != null) {
      const total = Math.round((r.finBalance + r.loanBalance) * 100) / 100;
      logger && logger.info(`融资融券(东财): 融资 ${r.finBalance} 融券 ${r.loanBalance} 合计 ${total}`);
      return {
        fin: r.finBalance,
        loan: r.loanBalance,
        total,
        date: r.date,
        source: 'eastmoney',
      };
    }
    logger && logger.warn('东财融资融券返回空，尝试备选源');
  } catch (e) {
    logger && logger.warn('东财融资融券拉取失败', e.message);
  }

  // 备选：上交所 + 深交所官方源（单位需换算）
  try {
    const [sse, szse] = await Promise.all([
      fetchSseMargin(http).catch(() => null),
      fetchSzseMargin(http).catch(() => null),
    ]);
    if (sse || szse) {
      if (!sse) logger && logger.warn('上交所融资融券备选失败，合计仅含深交所');
      if (!szse) logger && logger.warn('深交所融资融券备选失败，合计仅含上交所');
      // 上交所单位元，深交所单位亿元，统一换算为亿元
      const fin = (sse ? sse.fin : 0) + (szse ? szse.fin : 0);
      const loan = (sse ? sse.loan : 0) + (szse ? szse.loan : 0);
      return {
        fin: Math.round(fin * 100) / 100,
        loan: Math.round(loan * 100) / 100,
        total: Math.round((fin + loan) * 100) / 100,
        date: new Date().toISOString().slice(0, 10),
        source: 'exchange',
        partial: !sse || !szse,
      };
    }
  } catch (e) {
    logger && logger.warn('交易所融资融券备选拉取失败', e.message);
  }

  return { error: '融资融券数据获取失败', source: 'none' };
}

// 上交所融资融券（单位元，需 Referer）
async function fetchSseMargin(http) {
  const data = await http.get('https://query.sse.com.cn/marketdata/marginTrade/queryByBourseryType.do', {
    params: { jsonCallBack: '', isBegin: '0' },
    headers: { Referer: 'http://www.sse.com.cn/' },
    source: 'margin:sse',
  });
  // 上交所返回结构待 probe 核实，此处做防御性解析；解析不到返回 null（不返回假 0）
  const rows = data && data.result;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const fund = Number(r.fundBalance);
  const loan = Number(r.stockLoanBalance);
  if (!Number.isFinite(fund) || !Number.isFinite(loan)) return null;
  return {
    fin: fund / 1e8, // 元 → 亿元
    loan: loan / 1e8,
  };
}

// 深交所融资融券（单位亿元，需 Referer）
async function fetchSzseMargin(http) {
  const data = await http.get('https://www.szse.cn/api/report/ShowReport/data', {
    params: { SHOWTYPE: 'JSON', CatName: '融资融券', tabName: 'tabszse' },
    headers: { Referer: 'https://www.szse.cn/' },
    source: 'margin:szse',
  });
  // 深交所返回结构待 probe 核实：常见字段 rzjme(融资净买入)/rzmre(融资买入额) 等，
  // 余额字段未核实前返回 null（宁可缺失，不把深市当 0 混入合计）
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data[0] && data[0].data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const fin = Number(r.rzye ?? r.rzmre);
  const loan = Number(r.rqye);
  if (!Number.isFinite(fin) || !Number.isFinite(loan)) return null;
  return { fin, loan };
}

// 构造卡片用的融资融券数据（含较前日变动）
function formatMargin(margin, prevMargin) {
  if (margin.error) return { error: margin.error };
  const prev = prevMargin && !prevMargin.error ? prevMargin : null;
  const finDelta = prev ? Math.round((margin.fin - prev.fin) * 100) / 100 : null;
  const loanDelta = prev ? Math.round((margin.loan - prev.loan) * 100) / 100 : null;
  const totalDelta = prev ? Math.round((margin.total - prev.total) * 100) / 100 : null;
  return {
    fin: margin.fin,
    loan: margin.loan,
    total: margin.total,
    finDelta,
    loanDelta,
    totalDelta,
    source: margin.source,
  };
}

module.exports = { fetchMargin, formatMargin };
