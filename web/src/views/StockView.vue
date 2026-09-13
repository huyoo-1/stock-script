<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi.js';
import { useChart } from '../composables/useChart.js';

const { getJson, setStatus } = useApi();

const stockCode = ref('');
const stockName = ref('');
const stockSeries = ref([]);
const stockLoading = ref(false);
const searched = ref(false);
const recentStocks = ref([]);

const stockChart = useChart((chart) => {
  const s = stockSeries.value;
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '-' : String(v)) },
    legend: { data: ['收盘', 'MA5', 'MA10'], top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#5a6577' } },
    grid: { left: 48, right: 14, top: 30, bottom: 24 },
    xAxis: { type: 'category', data: s.map((x) => x.date.slice(5)), boundaryGap: false, axisLine: { lineStyle: { color: '#d0d3d8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#f2f4f8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    series: [
      { name: '收盘', type: 'line', data: s.map((x) => x.close), showSymbol: false, lineStyle: { width: 2.2 }, itemStyle: { color: '#1a2233' }, emphasis: { disabled: true } },
      { name: 'MA5', type: 'line', data: s.map((x) => x.ma5), showSymbol: false, lineStyle: { width: 1.5, type: 'dashed' }, itemStyle: { color: '#e0455a' }, emphasis: { disabled: true } },
      { name: 'MA10', type: 'line', data: s.map((x) => x.ma10), showSymbol: false, lineStyle: { width: 1.5, type: 'dashed' }, itemStyle: { color: '#e8a13a' }, emphasis: { disabled: true } },
    ],
  });
});

async function loadStock() {
  if (!/^\d{6}$/.test(stockCode.value)) return;
  searched.value = true;
  stockLoading.value = true;
  stockName.value = '';
  try {
    const r = await getJson('/api/stock/' + stockCode.value + '?days=60');
    stockName.value = r.name || '';
    stockSeries.value = r.series || [];
    const list = [stockCode.value, ...recentStocks.value.filter((c) => c !== stockCode.value)].slice(0, 6);
    recentStocks.value = list;
    try { localStorage.setItem('recentStocks', JSON.stringify(list)); } catch (e) {}
    await nextTick();
    stockChart.render();
  } catch (e) {
    stockSeries.value = [];
    setStatus('个股加载失败', 'error');
  } finally {
    stockLoading.value = false;
  }
}

onMounted(() => {
  stockChart.setupObserver();
  try { recentStocks.value = JSON.parse(localStorage.getItem('recentStocks') || '[]'); } catch (e) {}
});
</script>

<template>
  <section class="tab-panel">
    <el-card class="panel" shadow="never">
      <div class="search">
        <el-input v-model.trim="stockCode" placeholder="输入 6 位股票代码" inputmode="numeric" maxlength="6"
                  clearable @keyup.enter="loadStock" style="max-width: 320px" />
        <el-button type="primary" :loading="stockLoading" @click="loadStock">查询</el-button>
      </div>
      <div class="recent-tags" v-if="recentStocks.length">
        <el-tag v-for="c in recentStocks" :key="c" effect="plain" class="recent-tag" @click="stockCode = c; loadStock()">{{ c }}</el-tag>
      </div>
      <div class="stock-title" v-if="stockName">📈 {{ stockName }}（{{ stockCode }}）· 近 60 交易日</div>
      <div :ref="stockChart.setEl" id="chart-stock" class="chart" v-show="stockSeries.length > 0"></div>
      <el-skeleton v-if="stockLoading" animated style="margin-top: 14px">
        <template #template><el-skeleton-item variant="rect" style="height: 320px" /></template>
      </el-skeleton>
      <div class="empty" v-if="searched && !stockLoading && stockSeries.length === 0">暂无该股数据（数据积累中或代码有误）</div>
    </el-card>
  </section>
</template>
