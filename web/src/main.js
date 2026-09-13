import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

const app = createApp(App);

// 全局注册所有图标组件，模板里 <el-icon><DataAnalysis/></el-icon> 直接用
for (const [name, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, comp);
}

app.mount('#app');
