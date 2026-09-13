// 全A行情数据源：新浪分页（优先级0）+ 东财大包（优先级1）。
const { BaseFetcher } = require('./base');
const em = require('../emData');

const SINA_BULK_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_REFERER = 'https://finance.sina.com.cn/';
const SINA_PAGE_DELAY = { min: 1200, max: 2500 };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 新浪全A分页
class SinaAllAFetcher extends BaseFetcher {
  name = 'sinaAllA';
  priority = 0;
  capability = 'allA';
  marketSupport = new Set(['cn']);

  async fetch(http, { onProgress, maxPages } = {}) {
    const all = [];
    const pageSize = 80;
    const MAX_PAGES = maxPages > 0 ? maxPages : 80;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let rows;
      try {
        rows = await http.get(SINA_BULK_URL, {
          params: { page: String(page), num: String(pageSize), sort: 'amount', asc: '0', node: 'hs_a', symbol: '', _s_r_a: 'init' },
          headers: { Referer: SINA_REFERER },
          source: `allA:sina:p${page}`,
          sina: { minGap: randInt(1200, 2200) },
        });
      } catch (e) {
        const status = e.status || (e.response && e.response.status);
        if (status === 456) {
          const err = new Error(`新浪反爬封禁(456)，已抓 ${all.length} 只停止`);
          err.status = 456;
          throw err;
        }
        if (all.length >= 3000) break;
        throw e;
      }
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        all.push({
          code: String(r.code),
          name: r.name,
          market: r.symbol && r.symbol.startsWith('sh') ? 0 : 1,
          price: em.num(r.trade),
          preClose: em.num(r.settlement),
          amount: em.num(r.amount) || 0,
          chgPct: em.num(r.changepercent),
        });
      }
      onProgress && onProgress({ stage: 'allA', page, got: all.length });
      if (rows.length < pageSize) break;
      await sleep(randInt(SINA_PAGE_DELAY.min, SINA_PAGE_DELAY.max));
    }
    if (all.length < 3000) throw new Error(`新浪全A数据不足（${all.length} 只）`);
    return all;
  }
}

// 东财全A大包
class EmAllAFetcher extends BaseFetcher {
  name = 'emAllA';
  priority = 1;
  capability = 'allA';
  marketSupport = new Set(['cn']);

  async fetch(http) {
    const data = await http.get(em.EM_CLIST_URL, {
      params: { ...em.COMMON_PARAMS, pz: '6000', fields: em.FIELDS_BREADTH, fs: em.FS_ALL_A },
      source: 'allA:em',
      timeout: 15000,
      maxRetries: 1,
    });
    if (em.isEmBlocked(data)) throw new Error('东财大包被 URL 过滤');
    const rows = em.parseDiffRows(data, {
      f2: 'price', f3: 'chgPct', f12: 'code', f13: 'market', f14: 'name', f18: 'preClose', f6: 'amount',
    }).map((r) => ({
      code: String(r.code),
      name: r.name,
      market: r.market,
      price: em.num(r.price),
      preClose: em.num(r.preClose),
      amount: em.num(r.amount) || 0,
      chgPct: em.num(r.chgPct),
    }));
    if (rows.length < 3000) throw new Error(`东财大包数据不足（${rows.length} 只）`);
    return rows;
  }
}

module.exports = { SinaAllAFetcher, EmAllAFetcher };