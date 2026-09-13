// 契约核实脚本：打印原始 API 响应，核实数据源字段 + ETF/指数 secid。
// 用法: node tests/scripts/probe.js [all|breadth|constituents|margin|etf|index]
const path = require('path');
const { loadConfig } = require('../../lib/core/config');
const { createHttpClient } = require('../../lib/core/http');
const { CircuitBreaker } = require('../../lib/data/breakers');
const { FetcherManager } = require('../../lib/data/manager');
const { SinaAllAFetcher, EmAllAFetcher } = require('../../lib/data/allA');
const { SinaIndexFetcher, EmIndexFetcher, SinaEtfFetcher, EmEtfFetcher } = require('../../lib/data/indexQuote');
const { EmMarginFetcher, ExchangeMarginFetcher } = require('../../lib/data/margin');
const em = require('../../lib/emData');

const TARGET = process.argv[2] || 'all';
const cfg = loadConfig(path.join(__dirname, '..', '..', 'config.json'));
const http = createHttpClient({ maxRetries: 1, logger: { info: () => {}, warn: () => {}, error: (m, e) => console.error(m, e) } });
const cb = new CircuitBreaker();
const mgr = new FetcherManager({ circuitBreaker: cb, logger: { info: () => {}, warn: () => {}, error: (m, e) => console.error(m, e) } });
mgr.addFetcher(new SinaAllAFetcher());
mgr.addFetcher(new EmAllAFetcher());
mgr.addFetcher(new SinaIndexFetcher());
mgr.addFetcher(new EmIndexFetcher());
mgr.addFetcher(new SinaEtfFetcher());
mgr.addFetcher(new EmEtfFetcher());
mgr.addFetcher(new EmMarginFetcher());
mgr.addFetcher(new ExchangeMarginFetcher());

function header(t) {
  console.log(`\n========== ${t} ==========`);
}

async function probeBreadth() {
  header('全 A 股 spot（广度）');
  try {
    const { result, source } = await mgr.execute(http, {}, { capability: 'allA', validate: (rows) => rows.length >= 3000 });
    console.log(`数据源: ${source}`);
    if (!result) { console.log('无数据'); return; }
    console.log(`行数: ${result.length}`);
    console.log('样本(前3):', JSON.stringify(result.slice(0, 3), null, 2));
    const total = result.reduce((s, r) => s + (r.amount || 0), 0);
    console.log(`两市成交额合计: ${(total / 1e8).toFixed(2)} 亿元`);
  } catch (e) {
    console.error('失败:', e.message);
  }
}

async function probeConstituents() {
  header('指数成分股（从全A派生）');
  let allShares = null;
  try {
    const { result } = await mgr.execute(http, {}, { capability: 'allA', validate: (rows) => rows.length >= 3000 });
    allShares = result;
    console.log(`全A: ${allShares.length} 只`);
  } catch (e) {
    console.error('全A拉取失败:', e.message);
  }
  if (!allShares) return;
  for (const code of ['000001', '399006']) {
    console.log(`\n--- ${code} ---`);
    const rows = em.deriveConstituents(allShares, code);
    console.log(`派生成分股: ${rows.length} 行`);
    if (rows.length > 0) console.log('样本:', JSON.stringify(rows.slice(0, 3), null, 2));
  }
}

async function probeMargin() {
  header('融资融券');
  try {
    const raw = await http.get(em.EM_DATACENTER_URL, {
      params: {
        reportName: 'RPTA_WEB_MARGIN_DAILYTRADE',
        sortColumns: 'STATISTICS_DATE', sortTypes: '-1',
        pageSize: '1', pageNumber: '1', columns: 'ALL', source: 'WEB',
      },
      source: 'probe:margin',
    });
    console.log('原始响应(截前 2000 字符):');
    console.log(JSON.stringify(raw, null, 2).slice(0, 2000));
    const r = raw && raw.result && raw.result.data && raw.result.data[0];
    if (r) {
      console.log('\n字段名(供核实 FIN_BALANCE/LOAN_BALANCE):');
      console.log(Object.keys(r).join(', '));
    }
  } catch (e) {
    console.error('失败:', e.message);
  }
}

async function probeEtf() {
  header('宽基 ETF 成交额');
  for (const code of ['510300', '510050', '510500', '510310', '159915']) {
    try {
      const { result } = await mgr.execute(http, { code }, { capability: 'etfQuote' });
      console.log(`${code}: ${result ? JSON.stringify(result) : '无数据'}`);
    } catch (e) {
      console.log(`${code} 失败: ${e.message}`);
    }
  }
}

async function probeIndex() {
  header('指数行情');
  const list = [
    { code: '000001', exchange: 'SH', name: '上证指数' },
    { code: '399006', exchange: 'SZ', name: '创业板指' },
  ];
  for (const { code, exchange, name } of list) {
    try {
      const { result } = await mgr.execute(http, { code, exchange }, { capability: 'indexQuote' });
      console.log(`${name}(${code}): ${result ? JSON.stringify(result) : '无数据'}`);
    } catch (e) {
      console.log(`${name}(${code}) 失败: ${e.message}`);
    }
  }
}

(async () => {
  console.log(`探测目标: ${TARGET}`);
  if (TARGET === 'all' || TARGET === 'breadth') await probeBreadth();
  if (TARGET === 'all' || TARGET === 'constituents') await probeConstituents();
  if (TARGET === 'all' || TARGET === 'margin') await probeMargin();
  if (TARGET === 'all' || TARGET === 'etf') await probeEtf();
  if (TARGET === 'all' || TARGET === 'index') await probeIndex();
  console.log('\n========== 探测完成 ==========');
})().catch((e) => {
  console.error('探测异常:', e);
  process.exit(1);
});
