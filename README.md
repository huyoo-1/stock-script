# A 股大盘监控

一个本地 Node.js 服务，盘中定时抓取 A 股大盘数据，计算拥挤度和市场广度，然后推送到飞书。

## 快速开始

```bash
npm install
# 把 config.sample.json 复制一份改成自己的飞书配置
# 运行盘中快照一次测试
node service.js --once
# 手动跑一次完整收盘流程（抓取 → 推送 → 历史写入）
node tests/run_close_once.js
```

## 启动服务

### 前置条件

- Node.js 22+，已 `npm install`
- 已创建 `config.json` 并填写飞书 `appId` / `appSecret` / `chatId`（见 `config.sample.json`）

### 前台运行（调试用）

```bash
node service.js        # 或 npm start，前台运行，日志输出到控制台 + logs/run.log
node service.js --once # 只跑一次盘中快照后退出
```

### 后台常驻（推荐，开机自启 + 崩溃自动拉起）

用 [nssm](https://nssm.cc/)（单文件，无需安装）注册为 Windows 系统服务：

```powershell
nssm install AStockCrowdMonitor "C:\Program Files\nodejs\node.exe" "service.js"
nssm set AStockCrowdMonitor AppDirectory "d:\huyu_code\stock-script"
nssm set AStockCrowdMonitor AppStdout "d:\huyu_code\stock-script\logs\run.log"
nssm set AStockCrowdMonitor AppStderr "d:\huyu_code\stock-script\logs\run.log"
nssm set AStockCrowdMonitor AppRotateFiles 1
nssm set AStockCrowdMonitor AppRotateBytes 10485760
nssm start AStockCrowdMonitor
```

> 调度在进程内部完成（盘中 10:00 / 11:00 / 14:00 + 收盘 19:00），外层只负责拉起进程。Linux 对应使用 systemd（`Restart=always`）。

## 当前状态

**可用。** 数据抓取、飞书推送、本地历史写入全链路已跑通（2026-08-08 实测：全 A 5538 只，全程未触发封禁）。

## 数据源策略

- **主源：新浪财经**（当前网络最稳定）——全 A 分页抓取（约 70 页）、指数/ETF 行情、B 股
- **备选：东方财富**——融资融券余额走东财 `datacenter`（实测可用）；`push2` 行情接口在当前网络必失败，仅作兜底
- **反爬**：分页串行 + 随机间隔/UA/Cookie/Referer；456 封禁快速失败并降级，不无谓重试

## 测试脚本（tests/）

| 脚本 | 用途 |
|---|---|
| `breadth.test.js` / `crowd.test.js` / `screener.test.js` | 算法单测（`node --test tests/*.test.js`） |
| `test-feishu.js` | 飞书凭证自检（`npm run test:feishu`） |
| `probe.js` | 接口契约核实探针（`npm run probe`） |
| `run_close_once.js` | 手动跑一次完整收盘流程 |

## 已知限制

- 免费行情接口有风控：长时间高频抓取可能被新浪临时封禁（HTTP 456），一般 5 分钟到几小时自动解封
- 深交所融资融券备用接口字段尚未核实，东财主源不可用时该侧可能标记为缺失

## 最近改动

看 [CHANGELOG.md](./CHANGELOG.md)。
