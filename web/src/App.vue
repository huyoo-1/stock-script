<script setup>
import { ref, reactive, computed, provide, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import Topbar from './components/Topbar.vue';
import Tabbar from './components/Tabbar.vue';
import OverviewView from './views/OverviewView.vue';
import ScreenerView from './views/ScreenerView.vue';
import StockView from './views/StockView.vue';
import GoldView from './views/GoldView.vue';
import ConfigView from './views/ConfigView.vue';

const tab = ref('overview');
const tabs = [
  { id: 'overview', name: '概览', icon: 'DataAnalysis' },
  { id: 'screener', name: '筛选', icon: 'Search' },
  { id: 'stock',   name: '个股', icon: 'TrendCharts' },
  { id: 'gold',    name: '黄金', icon: 'GoldMedal' },
  { id: 'config',  name: '配置', icon: 'Setting' },
];
const currentTabName = computed(() => {
  const t = tabs.find((x) => x.id === tab.value);
  return t ? t.name : '';
});
const sidebarCollapsed = ref(false);

// 共享状态：顶栏 status + 概览/筛选共用的 screen
const status = reactive({
  text: '加载中',
  type: '',
  loading: true,
  firstLoading: true,
});
const hist = reactive({ dates: [], sh: [], cy: [] });
const screen = reactive({
  count: 0, readyDays: 0, neededDays: 10, candidates: 0, ma20Missing: 0,
  ma20Source: 'auto', updatedAt: null, items: [],
});
const lastDate = computed(() => hist.dates[hist.dates.length - 1] || '');

provide('app-status', status);
provide('app-hist', hist);
provide('app-screen', screen);

function switchTab(id) {
  tab.value = id;
}
</script>

<template>
  <Sidebar :tabs="tabs" :current="tab" :collapsed="sidebarCollapsed"
           @switch="switchTab" @toggle-collapse="sidebarCollapsed = !sidebarCollapsed" />
  <div class="main-wrap" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <Topbar :title="currentTabName" :collapsed="sidebarCollapsed"
            :status-text="status.text" :status-type="status.type" :loading="status.loading" :last-date="lastDate"
            @toggle-collapse="sidebarCollapsed = !sidebarCollapsed" />
    <main class="content">
      <OverviewView v-show="tab === 'overview'" />
      <ScreenerView v-show="tab === 'screener'" />
      <StockView v-show="tab === 'stock'" />
      <GoldView v-show="tab === 'gold'" />
      <ConfigView v-show="tab === 'config'" />
    </main>
  </div>
  <Tabbar :tabs="tabs" :current="tab" @switch="switchTab" />
</template>
