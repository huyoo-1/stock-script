import { ref, computed, watch } from 'vue';

// 筛选器三维过滤 + 虚拟滚动数学（原样移植自旧 index.html）
export function useScreenerFilter(screen, watched) {
  const filterBoard = ref('all');
  const filterPrice = ref('all');
  const filterWatched = ref(false);

  const boardFilters = [
    { value: 'all', label: '全部' },
    { value: 'main', label: '主板' },
    { value: 'cy', label: '创业板' },
    { value: 'kcb', label: '科创板' },
    { value: 'bjs', label: '北交所' },
  ];
  const priceFilters = [
    { value: 'all', label: '全部' },
    { value: 'lt20', label: '<20' },
    { value: '20-50', label: '20-50' },
    { value: '50-100', label: '50-100' },
    { value: '100-300', label: '100-300' },
    { value: '300-500', label: '300-500' },
    { value: '500-1000', label: '500-1000' },
    { value: '1000+', label: '1000+' },
  ];

  function matchPrice(p, range) {
    if (range === 'all') return true;
    if (p == null) return false;
    if (range === 'lt20') return p < 20;
    if (range === '1000+') return p >= 1000;
    const [lo, hi] = range.split('-').map(Number);
    return p >= lo && p < hi;
  }

  function toggleBoard(v) { filterBoard.value = filterBoard.value === v ? 'all' : v; }
  function togglePrice(v) { filterPrice.value = filterPrice.value === v ? 'all' : v; }
  function resetFilter() {
    filterBoard.value = 'all';
    filterPrice.value = 'all';
    filterWatched.value = false;
  }
  const hasFilter = computed(() => filterBoard.value !== 'all' || filterPrice.value !== 'all' || filterWatched.value);

  const filteredItems = computed(() => {
    return screen.items.filter((it) => {
      if (filterBoard.value !== 'all' && it.boardClass !== filterBoard.value) return false;
      if (!matchPrice(it.close, filterPrice.value)) return false;
      if (filterWatched.value && !watched[it.code]) return false;
      return true;
    });
  });

  // 虚拟滚动：itemHeight 72（row 纵向堆叠后高度）
  const scroller = ref(null);
  const scrollTop = ref(0);
  const containerHeight = ref(0);
  const itemHeight = 72;
  const overscan = 5;
  let pendingScroll = false;
  function onListScroll(e) {
    if (pendingScroll) return;
    pendingScroll = true;
    requestAnimationFrame(() => {
      scrollTop.value = e.target.scrollTop;
      containerHeight.value = e.target.clientHeight || containerHeight.value;
      pendingScroll = false;
    });
  }
  const visibleRange = computed(() => {
    const total = filteredItems.value.length;
    if (!containerHeight.value) return { start: 0, end: Math.min(total, 20) };
    const start = Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan);
    const end = Math.min(total, Math.ceil((scrollTop.value + containerHeight.value) / itemHeight) + overscan);
    return { start, end };
  });
  const visibleItems = computed(() => filteredItems.value.slice(visibleRange.value.start, visibleRange.value.end));
  const topHeight = computed(() => visibleRange.value.start * itemHeight);
  const bottomHeight = computed(() => (filteredItems.value.length - visibleRange.value.end) * itemHeight);

  function updateContainerHeight() {
    containerHeight.value = scroller.value ? scroller.value.clientHeight : 0;
  }

  watch(filteredItems, () => {
    scrollTop.value = 0;
    if (scroller.value) scroller.value.scrollTop = 0;
  });

  return {
    filterBoard, filterPrice, filterWatched, boardFilters, priceFilters,
    toggleBoard, togglePrice, resetFilter, hasFilter,
    filteredItems, visibleItems, topHeight, bottomHeight,
    scroller, onListScroll, updateContainerHeight,
  };
}
