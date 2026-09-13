// 指数/ETF行情数据源：新浪 hq（优先级0）+ 东财 stock/get（优先级1）。
const { BaseFetcher } = require('./base');
const em = require('../emData');

const SINA_HQ_URL = 'https://hq.sinajs.cn/list=';
const SINA_REFERER = 'https://finance.sina.com.cn/';

// 新浪行情：hq.sinajs.cn/list=sh000001
// 格式: var hq_str_sh000001="名称,昨收,今开,最新价,最高,最低,...,成交额(元),..."
// 返回 GBK 编码，用 responseType:'arraybuffer' 拿 Buffer 再 TextDecoder('gbk') 解码。
async function fetchSinaQuote(http, code, exchange, kind) {
  const prefix = (exchange === 'SH' ? 'sh' : 'sz') + code;
  let buffer;
  try {
    buffer = await http.get(SINA_HQ_URL + prefix, {
      headers: { Referer: SINA_REFERER },
      source: `sina:${kind}:${code}`,
      responseType: 'arraybuffer',
      maxRetries: 1,
    });
  } catch (e) {
    return null;
  }
  const text = new TextDecoder('gbk').decode(buffer);
  if (typeof text !== 'string') return null;
  const m = text.match(/hq_str_\w+="([^"]*)"/);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length < 10) return null;
  const name = parts[0];
  const preClose = em.num(parts[1]);
  const price = em.num(parts[3]);
  const amount = em.num(parts[9]);
  const chgPct = preClose && preClose > 0 ? Math.round(((price - preClose) / preClose) * 10000) / 100 : null;
  return { code, name, price, preClose, amount, chgPct, chg: price != null && preClose != null ? Math.round((price - preClose) * 100) / 100 : null };
}

// 新浪指数行情
class SinaIndexFetcher extends BaseFetcher {
  name = 'sinaIndex';
  priority = 0;
  capability = 'indexQuote';
  marketSupport = new Set(['cn']);

  async fetch(http, { code, exchange }) {
    const q = await fetchSinaQuote(http, code, exchange, 'index');
    if (q && q.price != null) return q;
    throw new Error('新浪指数行情无数据');
  }
}

// 东财指数/ETF行情
class EmIndexFetcher extends BaseFetcher {
  name = 'emIndex';
  priority = 1;
  capability = 'indexQuote';
  marketSupport = new Set(['cn']);

  async fetch(http, { code, exchange }) {
    const secid = em.toSecid(code, exchange);
    const data = await http.get(em.EM_STOCK_GET_URL, {
      params: { secid, fields: em.FIELDS_INDEX, fltt: '2', invt: '2' },
      source: `index:${code}:em`,
      maxRetries: 1,
    });
    if (em.isEmBlocked(data)) throw new Error('东财被 URL 过滤');
    const d = data && data.data;
    if (d && d.f57) {
      return { code: d.f57, name: d.f58, price: em.num(d.f43), preClose: em.num(d.f60), amount: em.num(d.f48), chgPct: em.num(d.f170) };
    }
    throw new Error('东财指数行情无数据');
  }
}

// 新浪 ETF 行情（复用 fetchSinaQuote，kind='etf'）
class SinaEtfFetcher extends BaseFetcher {
  name = 'sinaEtf';
  priority = 0;
  capability = 'etfQuote';
  marketSupport = new Set(['cn']);

  async fetch(http, { code }) {
    const exchange = code.startsWith('5') ? 'SH' : 'SZ';
    const q = await fetchSinaQuote(http, code, exchange, 'etf');
    if (q && q.amount != null) return q;
    throw new Error('新浪ETF行情无数据');
  }
}

// 东财 ETF 行情
class EmEtfFetcher extends BaseFetcher {
  name = 'emEtf';
  priority = 1;
  capability = 'etfQuote';
  marketSupport = new Set(['cn']);

  async fetch(http, { code }) {
    const exchange = code.startsWith('5') ? 'SH' : 'SZ';
    const secid = em.toSecid(code, exchange);
    const data = await http.get(em.EM_STOCK_GET_URL, {
      params: { secid, fields: em.FIELDS_INDEX, fltt: '2', invt: '2' },
      source: `etf:${code}:em`,
      maxRetries: 1,
    });
    if (em.isEmBlocked(data)) throw new Error('东财被 URL 过滤');
    const d = data && data.data;
    if (d && d.f57) {
      return { code: d.f57, name: d.f58, price: em.num(d.f43), preClose: em.num(d.f60), amount: em.num(d.f48) || 0, chgPct: em.num(d.f170) };
    }
    throw new Error('东财ETF行情无数据');
  }
}

module.exports = { SinaIndexFetcher, EmIndexFetcher, SinaEtfFetcher, EmEtfFetcher };