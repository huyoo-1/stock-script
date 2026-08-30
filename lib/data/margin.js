// 融资融券数据源：东财 datacenter（优先级0）+ 上交所/深交所（优先级1）。
const { BaseFetcher } = require('./base');
const em = require('../emData');

// 东财融资融券余额
class EmMarginFetcher extends BaseFetcher {
  name = 'emMargin';
  priority = 0;
  capability = 'margin';
  marketSupport = new Set(['cn']);

  async fetch(http) {
    const data = await http.get(em.EM_DATACENTER_URL, {
      params: {
        reportName: 'RPTA_WEB_MARGIN_DAILYTRADE',
        sortColumns: 'STATISTICS_DATE',
        sortTypes: '-1',
        pageSize: '1',
        pageNumber: '1',
        columns: 'ALL',
        source: 'WEB',
      },
      source: 'margin',
    });
    const rows = data && data.result && data.result.data;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('东财融资融券返回空');
    const r = rows[0];
    const fin = em.num(r.FIN_BALANCE);
    const loan = em.num(r.LOAN_BALANCE);
    if (fin == null || loan == null) throw new Error('东财融资融券字段缺失');
    return {
      fin: fin,
      loan: loan,
      total: Math.round((fin + loan) * 100) / 100,
      date: r.STATISTICS_DATE,
      source: 'eastmoney',
    };
  }
}

// 上交所融资融券（单位元，需 Referer）
async function fetchSseMargin(http) {
  const data = await http.get('https://query.sse.com.cn/marketdata/marginTrade/queryByBourseryType.do', {
    params: { jsonCallBack: '', isBegin: '0' },
    headers: { Referer: 'http://www.sse.com.cn/' },
    source: 'margin:sse',
  });
  const rows = data && data.result;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const fund = Number(r.fundBalance);
  const loan = Number(r.stockLoanBalance);
  if (!Number.isFinite(fund) || !Number.isFinite(loan)) return null;
  return { fin: fund / 1e8, loan: loan / 1e8 };
}

// 深交所融资融券（单位亿元，需 Referer）
async function fetchSzseMargin(http) {
  const data = await http.get('https://www.szse.cn/api/report/ShowReport/data', {
    params: { SHOWTYPE: 'JSON', CatName: '融资融券', tabName: 'tabszse' },
    headers: { Referer: 'https://www.szse.cn/' },
    source: 'margin:szse',
  });
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data[0] && data[0].data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const fin = Number(r.rzye ?? r.rzmre);
  const loan = Number(r.rqye);
  if (!Number.isFinite(fin) || !Number.isFinite(loan)) return null;
  return { fin, loan };
}

// 交易所融资融券（上交所+深交所并行，合成两市合计）
class ExchangeMarginFetcher extends BaseFetcher {
  name = 'exchangeMargin';
  priority = 1;
  capability = 'margin';
  marketSupport = new Set(['cn']);

  async fetch(http) {
    const [sse, szse] = await Promise.all([
      fetchSseMargin(http).catch(() => null),
      fetchSzseMargin(http).catch(() => null),
    ]);
    if (sse && szse) {
      const fin = Math.round((sse.fin + szse.fin) * 100) / 100;
      const loan = Math.round((sse.loan + szse.loan) * 100) / 100;
      return {
        fin, loan,
        total: Math.round((fin + loan) * 100) / 100,
        date: new Date().toISOString().slice(0, 10),
        source: 'exchange',
      };
    }
    const only = sse || szse;
    if (only) {
      return {
        fin: Math.round(only.fin * 100) / 100,
        loan: Math.round(only.loan * 100) / 100,
        total: Math.round((only.fin + only.loan) * 100) / 100,
        date: new Date().toISOString().slice(0, 10),
        source: 'exchange',
        partial: true,
        partialNote: sse ? '仅含沪市' : '仅含深市',
      };
    }
    throw new Error('交易所融资融券均不可用');
  }
}

module.exports = { EmMarginFetcher, ExchangeMarginFetcher };