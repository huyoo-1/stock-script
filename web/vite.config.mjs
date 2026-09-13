import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// dev 代理目标从 config.json 的 web.host/web.port 读，不写死（与 scripts/start-info.js 一致）
function readApiTarget() {
  try {
    const cfg = JSON.parse(readFileSync(fileURLToPath(new URL('../config.json', import.meta.url)), 'utf8'));
    const host = cfg.web?.host === '0.0.0.0' ? '127.0.0.1' : cfg.web?.host || '127.0.0.1';
    return `http://${host}:${cfg.web?.port || 8787}`;
  } catch {
    return 'http://127.0.0.1:8787';
  }
}
const apiTarget = readApiTarget();

// Web 面板 Vite 配置：dev 代理 /api 到 Node 服务，build 产物到 dist/
// Element Plus 按需自动导入：SFC 里写 <el-*> 无需手动 import；dts:false 避免将来装 typescript 后生成声明文件
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()], dts: false }),
    Components({ resolvers: [ElementPlusResolver()], dts: false }),
  ],
  root: fileURLToPath(new URL('.', import.meta.url)), // 固定到 web/ 目录，与 CWD 无关
  base: './',
  server: {
    port: 8089, // 起始端口；被占时自动递增（strictPort 默认 false），避免孤儿进程残留导致启动失败
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/vendor': { target: apiTarget, changeOrigin: true }, // echarts.min.js 仍由 Node 伺服
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
