<script setup>
import { ref, computed, inject, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useScreener } from '../composables/useScreener.js';
import { useScreenerFilter } from '../composables/useScreenerFilter.js';
import { useWatchlist } from '../composables/useWatchlist.js';

const screen = inject('app-screen');
const { loadScreener } = useScreener();
const { watched, watchMsg, loadWatched, toggleWatch } = useWatchlist();
const {
  filterBoard, filterPrice, filterWatched, boardFilters, priceFilters,
  toggleBoard, togglePrice, resetFilter, hasFilter,
  filteredItems, visibleItems, topHeight, bottomHeight,
  scroller, onListScroll, updateContainerHeight,
} = useScreenerFilter(screen, watched);

const screenLoading = ref(false);

const screenStatus = computed(() => {
  if (screen.readyDays < screen.neededDays) return '数据积累中（' + screen.readyDays + '/' + screen.neededDays + ' 个交易日）';
  if (screenLoading.value) return '正在拉取 MA20 二次精筛...';
  if (screen.ma20Source === 'off') return '✓ 共 ' + screen.count + ' 只符合条件（未启用 MA20 精筛）';
  return '✓ 共 ' + screen.count + ' 只符合 MA5>MA10>MA20（本地粗筛 ' + screen.candidates + ' 只，缺失 ' + screen.ma20Missing + ' 只）';
});

// 板块标签 type 映射
function boardTagType(boardClass) {
  const m = { main: 'info', cy: 'danger', kcb: 'primary', bjs: 'warning' };
  return m[boardClass] || 'info';
}

let listResizeObserver = null;

onMounted(async () => {
  await loadWatched();
  if (screen.items.length === 0) {
    screenLoading.value = true;
    await loadScreener();
    screenLoading.value = false;
  }
  await nextTick();
  updateContainerHeight();
  if (window.ResizeObserver && scroller.value) {
    listResizeObserver = new ResizeObserver(() => updateContainerHeight());
    listResizeObserver.observe(scroller.value);
  }
});

onUnmounted(() => {
  if (listResizeObserver) { listResizeObserver.disconnect(); listResizeObserver = null; }
});
</script>

<template>
  <section class="tab-panel">
    <el-card class="panel" shadow="never">
      <template #header>
        <div class="panel-head"><span>技术筛选<span class="title-sub">连续3日上涨 且 现价≥MA5/MA20，MA5&gt;MA10&gt;MA20</span></span></div>
      </template>
      <el-tag type="primary" effect="light" size="large" class="screen-status">{{ screenStatus }}</el-tag>
      <div class="filters" v-if="screen.items.length > 0">
        <div class="filter-row">
          <span class="filter-label">板块</span>
          <el-radio-group v-model="filterBoard" size="small">
            <el-radio-button v-for="b in boardFilters" :key="b.value" :value="b.value">{{ b.label }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-row">
          <span class="filter-label">价格</span>
          <el-radio-group v-model="filterPrice" size="small">
            <el-radio-button v-for="p in priceFilters" :key="p.value" :value="p.value">{{ p.label }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-row">
          <span class="filter-label">关注</span>
          <el-checkbox v-model="filterWatched">已关注</el-checkbox>
          <el-alert v-if="watchMsg" :title="watchMsg" type="error" :closable="false" show-icon style="margin-left:8px; padding: 2px 10px; flex: 0 0 auto;" />
          <span class="filter-summary">
            <span>{{ filteredItems.length }} / {{ screen.items.length }} 只</span>
            <el-button v-if="hasFilter" link type="primary" size="small" @click="resetFilter">重置</el-button>
          </span>
        </div>
      </div>
      <div class="list" ref="scroller" @scroll.passive="onListScroll">
        <div v-if="screenLoading" style="padding: 40px 0; text-align: center; color: var(--sub)">加载中...</div>
        <template v-else>
          <div class="empty" v-if="screen.items.length === 0">暂无符合条件的股票（需积累满 10 个交易日且通过 MA20 精筛）</div>
          <div class="empty" v-else-if="filteredItems.length === 0">当前筛选条件下无匹配个股，试试<el-button link type="primary" size="small" @click="resetFilter">重置筛选</el-button></div>
          <template v-else>
            <div class="spacer" :style="{ height: topHeight + 'px' }"></div>
            <div class="row" v-for="it in visibleItems" :key="it.code">
              <div class="row-top">
                <el-button text :type="watched[it.code] ? 'warning' : ''" class="watch-btn" :class="{ on: watched[it.code] }" @click="toggleWatch(it.code)" :title="watched[it.code] ? '取消关注' : '加入关注'">★</el-button>
                <div class="row-main">
                  <div class="row-code">{{ it.code }}<el-tag size="small" :type="boardTagType(it.boardClass)" effect="light" class="board-tag">{{ it.board }}</el-tag></div>
                  <div class="row-name">{{ it.name }}</div>
                </div>
              </div>
              <div class="row-nums">
                <span><span class="lbl">收</span> {{ it.close }}</span>
                <span><span class="lbl">MA5</span> {{ it.ma5 }}</span>
                <span><span class="lbl">MA10</span> {{ it.ma10 }}</span>
                <span><span class="lbl">MA20</span> {{ it.ma20 != null ? it.ma20 : '—' }}</span>
              </div>
            </div>
            <div class="spacer" :style="{ height: bottomHeight + 'px' }"></div>
          </template>
        </template>
      </div>
    </el-card>
  </section>
</template>
