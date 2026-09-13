import { reactive, ref, onMounted } from 'vue';
import { useApi } from './useApi.js';

// 关注列表：服务端存储（data/watchlist.json），跨设备同步
export function useWatchlist() {
  const watched = reactive({});
  const watchMsg = ref('');
  const { postJson } = useApi();

  async function loadWatched() {
    try {
      const arr = await fetch('/api/watchlist').then((x) => x.json());
      const list = Array.isArray(arr) ? arr : [];
      Object.keys(watched).forEach((k) => delete watched[k]);
      list.forEach((c) => { watched[c] = true; });
    } catch (e) {
      // 静默失败，watched 保持空
    }
  }

  async function saveWatched() {
    const codes = Object.keys(watched).filter((c) => watched[c]);
    try {
      await postJson('/api/watchlist', { codes });
    } catch (e) {
      watchMsg.value = '关注列表保存失败，刷新页面恢复';
      setTimeout(() => { watchMsg.value = ''; }, 3000);
    }
  }

  function toggleWatch(code) {
    if (watched[code]) delete watched[code];
    else watched[code] = true;
    saveWatched();
  }

  return { watched, watchMsg, loadWatched, saveWatched, toggleWatch };
}
