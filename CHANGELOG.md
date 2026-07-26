# 变更记录

## [Unreleased] - 2026-07-24

### 新增：首版代码实现

按 [docs/design.md](docs/design.md) v1.8 实现完整可运行代码，共 16 个文件。

**模块结构**

- `service.js` — 入口：bootstrap + 进程信号处理（SIGINT/SIGTERM 优雅关闭）+ uncaughtException 兜底；支持 `--once` 调试模式
- `lib/config.js` — 加载 + 校验 config.json，缺飞书凭证 fail-fast
- `lib/log.js` — stdout + 文件双输出日志，10MB 按大小轮转
- `lib/http.js` — 共享反爬客户端：随机 UA 池 + 同源限速（800-1500ms）+ 指数退避重试（1s/3s/8s + jitter）+ 可选 nid18 + SSL 证书放宽
- `lib/calendar.js` — A 股交易日/时段/午休判断，读 `data/holidays.json` 静态节假日表
- `lib/scheduler.js` — setTimeout 递归调度（非 setInterval，避免漂移），盘中点 + 收盘点各一个 timer
- `lib/emData.js` — 东财数据封装（clist/get + stock/get + datacenter）+ 新浪降级
- `lib/crowd.js` — 拥挤度算法（成交额前 5% 集中度），纯函数
- `lib/breadth.js` — 市场广度（涨跌家数/涨跌停/总成交额 + 活跃度分级），移植自参考程序涨跌停判定
- `lib/margin.js` — 融资融券余额（东财主源 + 上交所/深交所备选）
- `lib/etfFlow.js` — 宽基 ETF 成交额异动（国家队代理）
- `lib/history.js` — JSON 历史读写，原子写（.tmp + rename）防崩溃损坏
- `lib/cardBuilder.js` — 飞书卡片 JSON 组装，column_set + column 画真表格（lark_md 不支持表格）
- `lib/feishu.js` — 飞书官方 SDK + App Bot 推送，含 sendTest 自检
- `lib/runner.js` — 编排 runIntraday / runClose，并行拉取各数据源
- `scripts/probe.js` — 契约核实脚本，打印原始 API 响应
- `data/holidays.json` — 2026 年 A 股节假日表（手工维护）

**配置与依赖**

- `package.json` — 依赖 `axios` + `@larksuiteoapi/node-sdk`，可选 `https-proxy-agent`，engines node>=22
- `config.sample.json` — 配置模板
- `.gitignore` — 忽略 config.json / node_modules / logs / history.json

### 实测验证（算法 + 数据源）

- **算法单测**：拥挤度（20 只股前 5%=1 只，集中度 9.52%）、广度（688 股 +10% 不涨停 / 主板 +10% 涨停 / 停牌过滤）——逻辑全对
- **全 A 股**：5530 只，两市成交 19442 亿 ✅
- **拥挤度**：上证 48.63%（关注区，2308 成分股）、创业板 50.91%（预警区，1399 成分股）✅
- **指数行情**：上证 3814、创业板 3480 ✅
- **ETF 成交额**：5 只白名单全拿到 ✅
- **融资融券**：字段名 `FIN_BALANCE`/`LOAN_BALANCE`/`MARGIN_BALANCE` 确认，单位亿元 ✅

### 已知问题：公司网络屏蔽东财 push2 域名

> 当前部署环境为公司网络，存在域名屏蔽，影响部分数据源。换网络后需重新验证。

**屏蔽情况**（2026-07-24 实测）：

| 域名 | 状态 | 影响 | 已处理 |
|---|---|---|---|
| `push2.eastmoney.com`（clist/get、stock/get） | ❌ 被封（返回 HTML "URL过滤"，IP 层面屏蔽，非 UA/Referer 能绕过） | 全 A spot、指数成分股 primary、ETF/指数行情 primary | 已加新浪降级，实测可用 |
| `hq.sinajs.cn`（新浪行情） | ✅ 可用 | 降级源 | 已接入 |
| `vip.stock.finance.sina.com.cn`（新浪全 A 批量） | ✅ 可用 | 全 A spot 降级 | 已接入 |
| `qt.gtimg.cn`（腾讯行情） | ✅ 可用 | 备选降级源（未接入，备用） | — |
| `datacenter-web.eastmoney.com`（融资融券） | ✅ 可用 | 融资融券主源 | 已接入 |

**已做的降级处理**（`lib/emData.js`）：

- `fetchAllAShares` — 东财 clist/get 被封 → 降级新浪批量接口（分页拉 5530 只）
- `fetchIndexQuote` / `fetchEtfQuote` — 东财 stock/get 被封 → 降级新浪 hq.sinajs.cn
- `fetchIndexConstituents` — primary `b:<code>` 走东财被封 → fallback ② 全 A 按代码前缀过滤（上证 60/688、创业板 30），实测拿到 2308/1399 只

**换网络后需重新验证**：

1. 东财 push2 是否恢复可用（若可用，成分股 primary `b:` fs 需重新测哪个值生效，当前因封锁未验证）
2. 融资融券 `RPTA_WEB_MARGIN_DAILYTRADE` 时效问题（当前返回 2019 年旧数据，该 reportName 可能已停更；换网后若仍旧，需换 reportName 如 `RPT_BOURSE_RZRQ` 或用上交所/深交所官方源）
3. 跑 `node scripts/probe.js all` 重新核实全部契约

### 待用户实测（需飞书凭证）

- `npm run test:feishu` — 验证飞书 App Bot 凭证 + 入群 + `im:message` 权限（早发现 code 230002）
- `node service.js --once` — 跑一次完整盘中快照，确认飞书收到卡片
