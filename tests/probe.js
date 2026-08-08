// 契约核实脚本：打印原始 API 响应，核实三个未核实契约 + ETF/指数 secid。
// 用法: node tests/probe.js [all|breadth|constituents|margin|etf|index]
const path = require('path');
const { createHttpClient } = require('../lib/http');
const em = require('../lib/emData');

const TARGET = process.argv[2] || 'all';
const http = createHttpClient({ maxRetries: 1, logger: { info: () => {}, warn: () => {}, error: (m, e) => console.error(m, e) } });

function header(t) {
  console.log(`\n========== ${t} ==========`);
}

async function probeBreadth() {
  header('全 A 股 spot（广度）');
  try {
    const rows = await em.fetchAllAShares(http);
    console.log(`行数: ${rows.length}`);
    console.log('样本(前3):', JSON.stringify(rows.slice(0, 3), null, 2));
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    console.log(`两市成交额合计: ${(total / 1e8).toFixed(2)} 亿元`);
  } catch (e) {
    console.error('失败:', e.message);
  }
}

async function probeConstituents() {
  header('指数成分股（派生 + 三级降级）');
  // 先拉一次全 A，成分股优先从同一批数据派生（同源，减少新浪重复翻页）
  let allShares = null;
  try {
    allShares = await em.fetchAllAShares(http);
    console.log(`全A: ${allShares.length} 只`);
  } catch (e) {
    console.error('全A拉取失败:', e.message);
  }
  for (const code of ['000001', '399006']) {
    console.log(`\n--- ${code} ---`);
    try {
      const { rows, source } = await em.fetchIndexConstituents(http, code, allShares);
      console.log(`结果: source=${source}, ${rows.length} 行`);
      if (rows.length > 0) {
        console.log('样本:', JSON.stringify(rows.slice(0, 3), null, 2));
      }
    } catch (e) {
      console.log(`失败: ${e.message}`);
    }
  }
}

async function probeMargin() {
  header('融资融券（风险 #2）');
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
      const q = await em.fetchEtfQuote(http, code);
      console.log(`${code}: ${q ? JSON.stringify(q) : '无数据'}`);
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
      const q = await em.fetchIndexQuote(http, code, exchange);
      console.log(`${name}(${code}): ${q ? JSON.stringify(q) : '无数据'}`);
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
