<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessageBox } from 'element-plus';
import { useApi } from '../composables/useApi.js';

const { getJson, postJson } = useApi();

const configForm = reactive({
  indicesText: '', mode: 'both', intradayPointsText: '', closeTime: '19:00',
  thresholds: { normal: 40, warning: 50 }, historyDays: 5,
  maxRetries: 3, feishuMaxBytes: 20000,
  logConsoleLevel: 'ERROR', logDir: 'logs', proxy: '', nid18Enabled: false,
  feishu: { appId: '', appSecret: '', chatId: '', domain: 'feishu' },
  etfWhitelistText: '', goldStocksText: '', etfSurgeRatio: 2.5, marginUnit: '亿元',
  screener: { ma20Source: 'auto', ma20Days: 20, concurrency: 4, cacheTtlMs: 600000, bjCutoff: true, bjFailureThreshold: 3, bjWindowSize: 10 },
  dataSources: { circuitBreaker: { enabled: true, failureThreshold: 3, cooldownMs: 300000 } },
  web: { enabled: true, host: '127.0.0.1', port: 8787 },
  historyStorage: { enabled: true, autoCompact: true, dir: 'data/history', backupDir: 'data/history_backup', backupRetentionDays: 30 },
});
const configLoading = ref(false);
const configSaving = ref(false);
const configMsg = ref('');
const configMsgType = ref('');
const configErrors = ref([]);
const closeRunning = ref(false);
const closeMsg = ref('');
const closeMsgType = ref('');

// el-collapse 展开项（默认全展开）
const activeGroups = ref(['base', 'feishu', 'screener', 'breaker', 'web', 'history']);

async function loadConfig() {
  configLoading.value = true;
  configMsg.value = '';
  configErrors.value = [];
  try {
    const data = await getJson('/api/config');
    const c = data.config || {};
    configForm.indicesText = (c.indices || []).map((it) => `${it.name},${it.code},${it.exchange}`).join('\n');
    configForm.mode = c.mode || 'both';
    configForm.intradayPointsText = (c.intradayPoints || []).join(',');
    configForm.closeTime = c.closeTime || '19:00';
    configForm.thresholds = { normal: c.thresholds?.normal ?? 40, warning: c.thresholds?.warning ?? 50 };
    configForm.historyDays = c.historyDays ?? 5;
    configForm.maxRetries = c.maxRetries ?? 3;
    configForm.feishuMaxBytes = c.feishuMaxBytes ?? 20000;
    configForm.logConsoleLevel = c.logConsoleLevel || 'ERROR';
    configForm.logDir = c.logDir || 'logs';
    configForm.proxy = c.proxy || '';
    configForm.nid18Enabled = c.nid18Enabled ?? false;
    configForm.feishu = {
      appId: c.feishu?.appId || '', appSecret: c.feishu?.appSecret || '',
      chatId: c.feishu?.chatId || '', domain: c.feishu?.domain || 'feishu',
    };
    configForm.etfWhitelistText = (c.etfWhitelist || []).join(',');
    configForm.goldStocksText = (c.goldStocks || []).join(',');
    configForm.etfSurgeRatio = c.etfSurgeRatio ?? 2.5;
    configForm.marginUnit = c.marginUnit || '亿元';
    configForm.screener = {
      ma20Source: c.screener?.ma20Source || 'auto', ma20Days: c.screener?.ma20Days ?? 20,
      concurrency: c.screener?.concurrency ?? 4, cacheTtlMs: c.screener?.cacheTtlMs ?? 600000,
      bjCutoff: c.screener?.bjCutoff ?? true, bjFailureThreshold: c.screener?.bjFailureThreshold ?? 3,
      bjWindowSize: c.screener?.bjWindowSize ?? 10,
    };
    configForm.dataSources = {
      circuitBreaker: {
        enabled: c.dataSources?.circuitBreaker?.enabled ?? true,
        failureThreshold: c.dataSources?.circuitBreaker?.failureThreshold ?? 3,
        cooldownMs: c.dataSources?.circuitBreaker?.cooldownMs ?? 300000,
      },
    };
    configForm.web = {
      enabled: c.web?.enabled ?? true, host: c.web?.host || '127.0.0.1', port: c.web?.port ?? 8787,
    };
    configForm.historyStorage = {
      enabled: c.historyStorage?.enabled ?? true, autoCompact: c.historyStorage?.autoCompact ?? true,
      dir: c.historyStorage?.dir || 'data/history', backupDir: c.historyStorage?.backupDir || 'data/history_backup',
      backupRetentionDays: c.historyStorage?.backupRetentionDays ?? 30,
    };
  } catch (e) {
    configMsg.value = '加载失败：' + (e.message || e);
    configMsgType.value = 'error';
  } finally {
    configLoading.value = false;
  }
}

async function saveConfig() {
  configSaving.value = true;
  configMsg.value = '';
  configErrors.value = [];
  const patch = {
    indices: configForm.indicesText.split('\n').map((line) => {
      const [name, code, exchange] = line.split(',').map((s) => s.trim());
      return { name, code, exchange };
    }).filter((it) => it.code && it.name && it.exchange),
    mode: configForm.mode,
    intradayPoints: configForm.intradayPointsText.split(',').map((s) => s.trim()).filter(Boolean),
    closeTime: configForm.closeTime,
    thresholds: { normal: Number(configForm.thresholds.normal), warning: Number(configForm.thresholds.warning) },
    historyDays: Number(configForm.historyDays),
    maxRetries: Number(configForm.maxRetries),
    feishuMaxBytes: Number(configForm.feishuMaxBytes),
    logConsoleLevel: configForm.logConsoleLevel,
    logDir: configForm.logDir,
    proxy: configForm.proxy || null,
    nid18Enabled: configForm.nid18Enabled,
    feishu: { ...configForm.feishu },
    etfWhitelist: configForm.etfWhitelistText.split(',').map((s) => s.trim()).filter(Boolean),
    goldStocks: configForm.goldStocksText.split(',').map((s) => s.trim()).filter(Boolean),
    etfSurgeRatio: Number(configForm.etfSurgeRatio),
    marginUnit: configForm.marginUnit,
    screener: { ...configForm.screener },
    dataSources: { circuitBreaker: { ...configForm.dataSources.circuitBreaker } },
    web: { ...configForm.web },
    historyStorage: { ...configForm.historyStorage },
  };
  try {
    const data = await postJson('/api/config', patch);
    if (data.ok) {
      configMsg.value = data.message || '已保存，需重启服务生效';
      configMsgType.value = 'success';
    } else {
      configMsg.value = data.error || '保存失败';
      configErrors.value = data.errors || [];
      configMsgType.value = 'error';
    }
  } catch (e) {
    configMsg.value = e.message || '保存失败';
    configErrors.value = e.errors || [];
    configMsgType.value = 'error';
  } finally {
    configSaving.value = false;
  }
}

async function triggerClose() {
  try {
    await ElMessageBox.confirm(
      '将触发完整收盘流程：抓全A行情→算指标→技术筛选→推送飞书→写历史，耗时约1-3分钟。确认执行？',
      '触发收盘汇总',
      { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
    );
  } catch { return; } // 用户取消
  closeRunning.value = true;
  closeMsg.value = '';
  try {
    const data = await postJson('/api/run-close', {});
    closeMsg.value = data.message || '已触发，请查看日志/飞书群';
    closeMsgType.value = 'success';
  } catch (e) {
    closeMsg.value = e.message || '触发失败';
    closeMsgType.value = 'error';
    closeRunning.value = false;
  }
  setTimeout(() => { closeRunning.value = false; }, 90000);
}

onMounted(() => {
  loadConfig();
});
</script>

<template>
  <section class="tab-panel">
    <el-card class="panel" shadow="never" v-loading="configLoading">
      <template #header>
        <div class="panel-head"><span>配置管理<span class="title-sub">改完保存后需重启服务生效</span></span></div>
      </template>

      <el-collapse v-model="activeGroups">
        <el-collapse-item title="基础" name="base">
          <div class="config-fields">
            <div class="config-field wide">
              <label>监控指数（每行一个：名称,代码,交易所）</label>
              <el-input v-model="configForm.indicesText" type="textarea" :rows="3" placeholder="上证指数,000001,SH&#10;创业板指,399006,SZ" />
            </div>
            <div class="config-field">
              <label>推送模式</label>
              <el-select v-model="configForm.mode"><el-option label="盘中" value="intraday" /><el-option label="收盘" value="close" /><el-option label="全部" value="both" /></el-select>
            </div>
            <div class="config-field">
              <label>盘中快照点（逗号分隔）</label>
              <el-input v-model="configForm.intradayPointsText" placeholder="10:00,11:00,14:00" />
            </div>
            <div class="config-field">
              <label>收盘时间（HH:MM）</label>
              <el-input v-model="configForm.closeTime" placeholder="19:00" />
            </div>
            <div class="config-field">
              <label>拥挤度-正常阈值</label>
              <el-input-number v-model="configForm.thresholds.normal" :controls="false" />
            </div>
            <div class="config-field">
              <label>拥挤度-预警阈值</label>
              <el-input-number v-model="configForm.thresholds.warning" :controls="false" />
            </div>
            <div class="config-field">
              <label>历史保留天数</label>
              <el-input-number v-model="configForm.historyDays" :controls="false" />
            </div>
            <div class="config-field">
              <label>抓取重试次数</label>
              <el-input-number v-model="configForm.maxRetries" :controls="false" />
            </div>
            <div class="config-field">
              <label>飞书卡片字节上限</label>
              <el-input-number v-model="configForm.feishuMaxBytes" :controls="false" />
            </div>
            <div class="config-field">
              <label>控制台日志级别</label>
              <el-select v-model="configForm.logConsoleLevel">
                <el-option label="DEBUG" value="DEBUG" /><el-option label="INFO" value="INFO" /><el-option label="WARN" value="WARN" /><el-option label="ERROR" value="ERROR" />
              </el-select>
            </div>
            <div class="config-field">
              <label>日志目录</label>
              <el-input v-model="configForm.logDir" placeholder="logs" />
            </div>
            <div class="config-field">
              <label>HTTP 代理（空则不启用）</label>
              <el-input v-model="configForm.proxy" placeholder="http://127.0.0.1:7890" clearable />
            </div>
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.nid18Enabled">启用东财 nid18 设备指纹</el-checkbox>
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item title="飞书推送" name="feishu">
          <div class="config-fields">
            <div class="config-field">
              <label>App ID</label>
              <el-input v-model="configForm.feishu.appId" placeholder="cli_xxx" />
            </div>
            <div class="config-field">
              <label>App Secret</label>
              <el-input v-model="configForm.feishu.appSecret" type="password" show-password :placeholder="configForm.feishu.appSecret === '***' ? '已设置（如需修改请直接输入新值）' : '输入 app_secret'" />
              <span class="field-hint" v-if="configForm.feishu.appSecret === '***'">已设置（不显示明文，保存时自动保留原值）</span>
            </div>
            <div class="config-field">
              <label>群 Chat ID</label>
              <el-input v-model="configForm.feishu.chatId" placeholder="oc_xxx" />
            </div>
            <div class="config-field">
              <label>域名</label>
              <el-select v-model="configForm.feishu.domain"><el-option label="feishu" value="feishu" /><el-option label="lark" value="lark" /></el-select>
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item title="技术筛选" name="screener">
          <div class="config-fields">
            <div class="config-field wide">
              <label>ETF 白名单（逗号分隔）</label>
              <el-input v-model="configForm.etfWhitelistText" placeholder="510300,510050,510500" />
            </div>
            <div class="config-field wide">
              <label>黄金股 / ETF（逗号分隔）</label>
              <el-input v-model="configForm.goldStocksText" placeholder="600547,601899,518880" />
            </div>
            <div class="config-field">
              <label>ETF 异动倍数</label>
              <el-input-number v-model="configForm.etfSurgeRatio" :controls="false" :step="0.1" />
            </div>
            <div class="config-field">
              <label>融资融券单位</label>
              <el-input v-model="configForm.marginUnit" />
            </div>
            <div class="config-field">
              <label>MA20 数据源</label>
              <el-select v-model="configForm.screener.ma20Source"><el-option label="auto" value="auto" /><el-option label="tencent" value="tencent" /><el-option label="sina" value="sina" /><el-option label="off" value="off" /></el-select>
            </div>
            <div class="config-field">
              <label>MA20 天数</label>
              <el-input-number v-model="configForm.screener.ma20Days" :controls="false" />
            </div>
            <div class="config-field">
              <label>精筛并发数</label>
              <el-input-number v-model="configForm.screener.concurrency" :controls="false" />
            </div>
            <div class="config-field">
              <label>日K缓存毫秒</label>
              <el-input-number v-model="configForm.screener.cacheTtlMs" :controls="false" />
            </div>
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.screener.bjCutoff">启用北交所熔断</el-checkbox>
            </div>
            <div class="config-field">
              <label>北交所失败阈值</label>
              <el-input-number v-model="configForm.screener.bjFailureThreshold" :controls="false" />
            </div>
            <div class="config-field">
              <label>北交所统计窗口</label>
              <el-input-number v-model="configForm.screener.bjWindowSize" :controls="false" />
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item title="数据源熔断" name="breaker">
          <div class="config-fields">
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.dataSources.circuitBreaker.enabled">启用熔断</el-checkbox>
            </div>
            <div class="config-field">
              <label>失败阈值</label>
              <el-input-number v-model="configForm.dataSources.circuitBreaker.failureThreshold" :controls="false" />
            </div>
            <div class="config-field">
              <label>冷却毫秒</label>
              <el-input-number v-model="configForm.dataSources.circuitBreaker.cooldownMs" :controls="false" />
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item title="Web 面板" name="web">
          <div class="config-fields">
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.web.enabled">启用 Web</el-checkbox>
            </div>
            <div class="config-field">
              <label>监听地址</label>
              <el-input v-model="configForm.web.host" placeholder="127.0.0.1" />
            </div>
            <div class="config-field">
              <label>端口</label>
              <el-input-number v-model="configForm.web.port" :controls="false" />
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item title="历史存储" name="history">
          <div class="config-fields">
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.historyStorage.enabled">启用</el-checkbox>
            </div>
            <div class="config-field checkbox">
              <el-checkbox v-model="configForm.historyStorage.autoCompact">周五自动整理</el-checkbox>
            </div>
            <div class="config-field">
              <label>历史目录</label>
              <el-input v-model="configForm.historyStorage.dir" placeholder="data/history" />
            </div>
            <div class="config-field">
              <label>备份目录</label>
              <el-input v-model="configForm.historyStorage.backupDir" placeholder="data/history_backup" />
            </div>
            <div class="config-field">
              <label>备份保留天数</label>
              <el-input-number v-model="configForm.historyStorage.backupRetentionDays" :controls="false" />
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div class="config-actions">
        <el-button type="primary" :loading="configSaving" @click="saveConfig">保存配置</el-button>
        <el-alert v-if="configMsg" :title="configMsg" :type="configMsgType" :closable="false" show-icon style="flex: 1; min-width: 0">
          <ul v-if="configErrors.length" class="config-error-list">
            <li v-for="err in configErrors" :key="err">{{ err }}</li>
          </ul>
        </el-alert>
      </div>

      <div class="danger-zone">
        <div class="danger-zone-title">手动触发收盘汇总</div>
        <el-button type="danger" :loading="closeRunning" @click="triggerClose">立即触发收盘流程</el-button>
        <el-alert v-if="closeMsg" :title="closeMsg" :type="closeMsgType" :closable="false" show-icon style="margin-left:12px; flex: 1; min-width: 0" />
      </div>
    </el-card>
  </section>
</template>
