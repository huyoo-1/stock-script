import { inject } from 'vue';
import { useApi } from './useApi';

// 筛选数据加载：screen 为 App.vue 提供的共享 reactive
export function useScreener() {
  const screen = inject('app-screen');
  const { getJson, setStatus } = useApi();

  function boardOf(code) {
    const c = String(code);
    if (/^(43|83|87|92|920)/.test(c)) return 'bjs';
    if (/^30/.test(c)) return 'cy';
    if (/^68/.test(c)) return 'kcb';
    return 'main';
  }
  function boardLabel(code) {
    const m = { main: '主板', cy: '创', kcb: '科', bjs: '北' };
    return m[boardOf(code)] || '主板';
  }

  let loading = false;
  async function loadScreener() {
    if (!screen || loading) return;
    loading = true;
    try {
      const r = await getJson('/api/screener?upDays=3');
      const items = (r.items || []).map((it) => {
        const b = boardOf(it.code);
        return { ...it, board: boardLabel(it.code), boardClass: b };
      });
      Object.assign(screen, r, { items });
    } catch (e) {
      setStatus('筛选加载失败', 'error');
    } finally {
      loading = false;
    }
  }

  return { screen, loadScreener, boardOf, boardLabel };
}
