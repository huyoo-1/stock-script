// 黄金金价数据源：新浪 hq（伦敦金现货 hf_XAU 等）。
// 新浪黄金行情格式与股票不同：名称在末尾(parts[13])，无成交额字段，故独立解析。
const { BaseFetcher } = require('./base');
const em = require('../emData');

const SINA_HQ_URL = 'https://hq.sinajs.cn/list=';
const SINA_REFERER = 'https://finance.sina.com.cn/';

// 新浪黄金行情：hq.sinajs.cn/list=hf_XAU
// 格式: var hq_str_hf_XAU="现价,昨收,开,最新,最高,最低,时间,...,日期,名称"
async function fetchSinaGold(http, contract) {
  const buffer = await http.get(SINA_HQ_URL + contract, {
    headers: { Referer: SINA_REFERER },
    source: `sina:gold:${contract}`,
    responseType: 'arraybuffer',
    maxRetries: 1,
  });
  const text = new TextDecoder('gbk').decode(buffer);
  const m = text.match(/hq_str_\w+="([^"]*)"/);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length < 14) return null;
  return {
    code: contract,
    name: parts[13],
    price: em.num(parts[0]),
    preClose: em.num(parts[1]),
    high: em.num(parts[4]),
    low: em.num(parts[5]),
    date: parts[12],
  };
}

// 新浪黄金行情 fetcher（capability=goldPrice）
class SinaGoldPriceFetcher extends BaseFetcher {
  name = 'sinaGold';
  priority = 0;
  capability = 'goldPrice';
  marketSupport = null; // 黄金非 A 股，不限市场

  async fetch(http, { contract = 'hf_XAU' } = {}) {
    const q = await fetchSinaGold(http, contract);
    if (q && q.price != null) return q;
    throw new Error('新浪黄金行情无数据');
  }
}

module.exports = { SinaGoldPriceFetcher, fetchSinaGold };
