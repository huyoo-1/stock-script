import { inject } from 'vue';

// 轻量 fetch 封装：错误抛出带 message，调用方自行更新共享 status
export function useApi() {
  const status = inject('app-status');

  function setStatus(text, type) {
    if (!status) return;
    status.text = text;
    if (type !== undefined) status.type = type;
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('服务异常（' + res.status + '）');
    return res.json();
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 优先用服务端返回的 error / message（如「非交易日，已跳过收盘流程」），最后才退到状态码
      const err = new Error(data.error || data.message || '请求失败（' + res.status + '）');
      err.errors = data.errors || [];
      throw err;
    }
    return data;
  }

  return { getJson, postJson, setStatus };
}
