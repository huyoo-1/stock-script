<script setup>
import { ref, computed, inject, onMounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi.js';
import { useChart } from '../composables/useChart.js';
import { useScreener } from '../composables/useScreener.js';

const hist = inject('app-hist');
const { screen, loadScreener } = useScreener();
const { getJson, setStatus } = useApi();
const status = inject('app-status');

const histDays = ref(60);
const intradaySeries = ref([]);

const lastDate = computed(() => hist.dates[hist.dates.length - 1] || '');

const metricCards = computed(() => {
  const lastSh = hist.sh[hist.sh.length - 1];
  const prevSh = hist.sh[hist.sh.length - 2];
  const lastCy = hist.cy[hist.cy.length - 1];
  const prevCy = hist.cy[hist.cy.length - 2];
  const tone = (v) => (v == null ? 'var(--text)' : v >= 50 ? 'var(--up)' : v >= 40 ? 'var(--warn)' : 'var(--down)');
  const accent = (v) => (v == null ? 'transparent' : v >= 50 ? 'var(--up)' : v >= 40 ? 'var(--warn)' : 'var(--down)');
  const fmtDelta = (last, prev) => {
    if (last == null || prev == null) return null;
    const d = Math.round((last - prev) * 10) / 10;
    return (d > 0 ? '+' : '') + d + 'pp';
  };
  const deltaSh = fmtDelta(lastSh, prevSh);
  const deltaCy = fmtDelta(lastCy, prevCy);
  const ready = screen.readyDays >= screen.neededDays;
  return [
    { label: '上证拥挤度', value: lastSh != null ? lastSh + '%' : '—', sub: '阈值 40 / 50', color: tone(lastSh), accent: accent(lastSh), delta: deltaSh, deltaDir: deltaSh > 0 ? 'up' : 'down', deltaArrow: deltaSh > 0 ? '▲' : '▼' },
    { label: '创业板拥挤度', value: lastCy != null ? lastCy + '%' : '—', sub: '阈值 40 / 50', color: tone(lastCy), accent: accent(lastCy), delta: deltaCy, deltaDir: deltaCy > 0 ? 'up' : 'down', deltaArrow: deltaCy > 0 ? '▲' : '▼' },
    { label: '筛选命中', value: ready ? screen.count : '—', sub: screen.readyDays + '/' + screen.neededDays + ' 天', color: 'var(--primary)', accent: 'var(--primary)', delta: null },
    { label: '数据状态', value: ready ? '就绪' : '积累中', sub: screen.updatedAt || '', color: ready ? 'var(--down)' : 'var(--warn)', accent: ready ? 'var(--down)' : 'var(--warn)', delta: null },
  ];
});

// 拥挤度历史图
const histChart = useChart((chart) => {
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '-' : v + '%') },
    legend: { data: ['上证', '创业板'], top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#5a6577' } },
    grid: { left: 42, right: 14, top: 30, bottom: 24 },
    xAxis: { type: 'category', data: hist.dates, boundaryGap: false, axisLine: { lineStyle: { color: '#d0d3d8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#f2f4f8' } }, axisLabel: { fontSize: 10, color: '#8a93a6', formatter: '{value}%' } },
    series: [
      { name: '上证', type: 'line', data: hist.sh, smooth: true, showSymbol: false, lineStyle: { width: 2.2 }, itemStyle: { color: '#e0455a' }, emphasis: { disabled: true } },
      { name: '创业板', type: 'line', data: hist.cy, smooth: true, showSymbol: false, lineStyle: { width: 2.2 }, itemStyle: { color: '#2f6df0' }, emphasis: { disabled: true } },
    ],
  });
});

// 盘中轨迹图
const intradayChart = useChart((chart) => {
  const records = intradaySeries.value;
  const crowdingOf = (r, code) => {
    const i = (r.indices || []).find((x) => x.code === code);
    return i ? i.crowding : null;
  };
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '-' : v + '%') },
    legend: { data: ['上证', '创业板'], top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: '#5a6577' } },
    grid: { left: 42, right: 14, top: 30, bottom: 24 },
    xAxis: { type: 'category', data: records.map((r) => r.time || ''), boundaryGap: false, axisLine: { lineStyle: { color: '#d0d3d8' } }, axisLabel: { fontSize: 10, color: '#8a93a6' } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#f2f4f8' } }, axisLabel: { fontSize: 10, color: '#8a93a6', formatter: '{value}%' } },
    series: [
      { name: '上证', type: 'line', data: records.map((r) => crowdingOf(r, '000001')), smooth: true, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: '#e0455a' }, emphasis: { disabled: true } },
      { name: '创业板', type: 'line', data: records.map((r) => crowdingOf(r, '399006')), smooth: true, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: '#2f6df0' }, emphasis: { disabled: true } },
    ],
  });
});

async function loadHist(days) {
  histDays.value = days;
  status.loading = true;
  status.type = '';
  try {
    const r = await getJson('/api/indices/history?days=' + days);
    Object.assign(hist, r);
    status.text = '已刷新';
    status.loading = false;
    status.firstLoading = false;
    await nextTick();
    histChart.render();
    loadIntraday();
  } catch (e) {
    status.text = '加载失败';
    status.type = 'error';
    status.loading = false;
    status.firstLoading = false;
  }
}

async function loadIntraday() {
  try {
    const r = await getJson('/api/intraday?date=today');
    intradaySeries.value = r.records || [];
    await nextTick();
    intradayChart.render();
  } catch (e) {
    intradaySeries.value = [];
  }
}

onMounted(async () => {
  histChart.setupObserver();
  intradayChart.setupObserver();
  await loadHist(60);
  if (screen.items.length === 0) loadScreener();
});
</script>

<template>
  <section class="tab-panel">
    <el-row :gutter="12" v-if="!status.firstLoading">
      <el-col v-for="c in metricCards" :key="c.label" :xs="12" :sm="6">
        <el-card class="card" shadow="hover" :style="{ '--accent': c.accent }">
          <div class="card-label">{{ c.label }}</div>
          <div class="card-value" :style="{ color: c.color }">{{ c.value }}</div>
          <div class="card-delta" v-if="c.delta != null" :class="c.deltaDir">{{ c.deltaArrow }}{{ c.delta }}</div>
          <div class="card-sub">{{ c.sub }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="12" v-else>
      <el-col v-for="n in 4" :key="n" :xs="12" :sm="6">
        <el-skeleton animated>
          <template #template><el-skeleton-item variant="rect" style="height: 96px; border-radius: 16px" /></template>
        </el-skeleton>
      </el-col>
    </el-row>
    <div class="overview-grid">
      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-head">
            <span>指数拥挤度<span class="title-sub">前 5% 成分股成交额占比</span></span>
            <el-radio-group v-model="histDays" size="small" @change="loadHist(histDays)">
              <el-radio-button v-for="d in [30, 60, 120]" :key="d" :value="d">{{ d }}日</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div :ref="histChart.setEl" id="chart-hist" class="chart" v-show="!status.firstLoading"></div>
        <el-skeleton v-if="status.firstLoading" animated>
          <template #template><el-skeleton-item variant="rect" style="height: 320px" /></template>
        </el-skeleton>
      </el-card>
      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-head"><span>当日盘中轨迹<span class="title-sub">拥挤度盘中变化</span></span></div>
        </template>
        <div :ref="intradayChart.setEl" id="chart-intraday" class="chart" v-show="intradaySeries.length > 0"></div>
        <div class="empty" v-if="!status.loading && intradaySeries.length === 0">暂无当日盘中数据</div>
      </el-card>
    </div>
  </section>
</template>
