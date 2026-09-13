<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi.js';
import { useChart } from '../composables/useChart.js';

const { getJson, setStatus } = useApi();

const goldDays = ref(60);
const goldLoading = ref(false);
const goldSeries = reactive({ dates: [], goldPrice: [], stocks: [] });

const goldChart = useChart((chart) => {
  const s = goldSeries;
  const stockSeriesList = s.stocks.map((st) => ({
    name: st.name, type: 'line', yAxisIndex: 1, data: st.series,
    showSymbol: false, lineStyle: { width: 1.5 }, emphasis: { disabled: true },
  }));
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '-' : String(v)) },
    legend: { data: ['伦敦金', ...s.stocks.map((st) => st.name)], top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#5a6577' } },
    grid: { left: 52, right: 60, top: 30, bottom: 24 },
    xAxis: { type: 'category', data: s.dates.map((d) => d.slice(5)), boundaryGap: false, axisLine: { lineStyle: { color: '#d0d3d8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    yAxis: [
      { type: 'value', name: '金价', position: 'left', scale: true, splitLine: { lineStyle: { color: '#f2f4f8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
      { type: 'value', name: '股价', position: 'right', scale: true, splitLine: { show: false }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    ],
    series: [
      { name: '伦敦金', type: 'line', yAxisIndex: 0, data: s.goldPrice, showSymbol: false, lineStyle: { width: 2.2 }, itemStyle: { color: '#e8a13a' }, emphasis: { disabled: true } },
      ...stockSeriesList,
    ],
  });
});

async function loadGold(days) {
  goldDays.value = days;
  goldLoading.value = true;
  try {
    const r = await getJson('/api/gold/history?days=' + days);
    Object.assign(goldSeries, r);
    await nextTick();
    goldChart.render();
  } catch (e) {
    setStatus('黄金加载失败', 'error');
  } finally {
    goldLoading.value = false;
  }
}

onMounted(() => {
  goldChart.setupObserver();
  loadGold(goldDays.value);
});
</script>

<template>
  <section class="tab-panel">
    <el-card class="panel" shadow="never">
      <template #header>
        <div class="panel-head">
          <span>黄金走势<span class="title-sub">伦敦金现货（美元/盎司）叠加黄金股/ETF 收盘价</span></span>
          <el-radio-group v-model="goldDays" size="small" @change="loadGold(goldDays)">
            <el-radio-button v-for="d in [30, 60, 120]" :key="d" :value="d">{{ d }}日</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <div :ref="goldChart.setEl" id="chart-gold" class="chart" v-show="goldSeries.dates.length > 0"></div>
      <el-skeleton v-if="goldLoading" animated>
        <template #template><el-skeleton-item variant="rect" style="height: 320px" /></template>
      </el-skeleton>
      <div class="empty" v-if="!goldLoading && goldSeries.dates.length === 0">暂无黄金数据（收盘后积累）</div>
    </el-card>
  </section>
</template>
