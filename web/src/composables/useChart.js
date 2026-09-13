import { ref, onUnmounted } from 'vue';

// ECharts 生命周期：懒 init + ResizeObserver + 卸载 dispose
// 阶段一仍用全局 echarts（vendor script），阶段二改 import
export function useChart(renderFn) {
  const el = ref(null);
  let chart = null;
  let observer = null;

  // 函数式 ref：模板用 :ref="setEl" 绑定
  function setEl(node) {
    el.value = node;
  }

  function ensureAndResize() {
    const node = el.value;
    if (!node) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    if (w > 0 && h > 0) {
      if (!chart) chart = window.echarts.init(node, null, { renderer: 'canvas' });
      renderFn(chart);
      chart.resize();
    }
  }

  function setupObserver() {
    if (!window.ResizeObserver || !el.value) return;
    observer = new window.ResizeObserver(ensureAndResize);
    observer.observe(el.value);
  }

  function render() {
    if (chart) {
      renderFn(chart);
    } else {
      ensureAndResize();
    }
  }

  onUnmounted(() => {
    if (observer) { observer.disconnect(); observer = null; }
    if (chart) { chart.dispose(); chart = null; }
  });

  return { el, setEl, render, ensureAndResize, setupObserver };
}
