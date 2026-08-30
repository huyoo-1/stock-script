// 日K线数据源：腾讯主域名（优先级0）+ 腾讯备选域名 + 新浪（优先级1）。
const { BaseFetcher } = require('./base');
const kl = require('../kline');

const TENCENT_KLINE_URL = 'https://ifzq.gtimg.cn/appstock/app/fqkline/get';
const TENCENT_KLINE_URL_FALLBACK = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get';
const SINA_KLINE_URL = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData';
const SINA_REFERER = 'https://finance.sina.com.cn/';
const TENCENT_GAP = { min: 600, max: 1200 };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 腾讯日K - 主域名
class TencentKlineFetcher extends BaseFetcher {
  name = 'tencentKline';
  priority = 0;
  capability = 'kline';
  marketSupport = new Set(['cn']);

  async fetch(http, { code, days = 20 }) {
    const secid = kl.toSecid(code);
    const opts = {
      params: { param: `${secid},day,,,${days},` },
      headers: { Referer: 'https://gu.qq.com/' },
      source: `kline:tencent:${code}`,
      minGap: randInt(TENCENT_GAP.min, TENCENT_GAP.max),
      maxRetries: 1,
    };
    let data;
    try {
      data = await http.get(TENCENT_KLINE_URL, opts);
    } catch (e) {
      // 501 即时熔断已在 CircuitBreaker 层处理，这里尝试备选域名
      const status = e.status || (e.response && e.response.status);
      if (status === 501) {
        opts.source = `kline:tencent-alt:${code}`;
        data = await http.get(TENCENT_KLINE_URL_FALLBACK, opts);
      } else {
        throw e;
      }
    }
    if (data && data.code !== 0) {
      throw new Error(`腾讯日K返回异常 code=${data.code}`);
    }
    const rows = kl.parseTencentKline(data, secid);
    if (rows.length < days) throw new Error(`腾讯日K数据不足 ${code}（${rows.length}/${days}）`);
    return rows;
  }
}

// 新浪日K
class SinaKlineFetcher extends BaseFetcher {
  name = 'sinaKline';
  priority = 1;
  capability = 'kline';
  marketSupport = new Set(['cn']);

  async fetch(http, { code, days = 20 }) {
    const symbol = kl.toSecid(code);
    const text = await http.get(SINA_KLINE_URL, {
      params: { symbol, scale: '240', ma: 'no', datalen: String(days) },
      headers: { Referer: SINA_REFERER },
      source: `kline:sina:${code}`,
      responseType: 'text',
      maxRetries: 2,
    });
    const rows = kl.parseSinaKline(text);
    if (rows.length < days) throw new Error(`新浪日K数据不足 ${code}（${rows.length}/${days}）`);
    return rows;
  }
}

module.exports = { TencentKlineFetcher, SinaKlineFetcher };