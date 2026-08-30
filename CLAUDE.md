# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1.硬规则
- 没有我的允许，不准主动提交代码，包括`git commit`、`git tag`、`git push`。
- commit 信息写简单点，不要写长篇大论。
- 代码注释写简洁点，不要写一大堆术语。
- 不写死密钥、账号、路径、模型名、端口或环境差异逻辑。
- 优先复用现有模块、配置入口、脚本和测试，不新增平行实现。
- 默认稳定性优先于"顺手优化"；非当前任务直接需要的重构、抽象和基础设施迁移一律克制。
- `README.md` 只用于项目定位、核心能力总览、快速开始、主要入口、赞助/合作等首页级信息；非必要不更新 README，避免持续膨胀。
- 注释、docstring、日志文案以清晰准确为准，不用写英文，但应与文件语境保持一致。
- 更细的模块行为、页面交互、专题配置、排障说明、字段契约、实现语义和边界条件，优先更新对应 `docs/*.md` 或专题文档，不写入 README。
- 开发代码前，先读一下 `docs/*` 下面的设计文档，理解透设计思路再开始写代码。
- 涉及用户可见能力、CLI/API 行为、部署方式、通知方式、报告结构变化时，必须同步更新相关文档与 `docs/CHANGELOG.md`。
- `docs/CHANGELOG.md` 的 `[Unreleased]` 段使用**扁平格式**：每条独立一行，格式为 `- [类型] 描述`，类型取值：`新功能`/`改进`/`修复`/`文档`/`测试`/`chore`；**禁止在 `[Unreleased]` 内新增 `### 类目标题`**，以减少并发 PR 的 merge 冲突。发版时由 maintainer 汇总整理成带标题的正式格式。
- 新增配置项时，必须同步更新 `config.sample.json` 和相关文档。

### 1.1 PR 标题规范（非阻断建议）

- 推荐使用 `<类型>: <修改内容>` 作为 PR 标题，例如 `fix: 修复大盘分析历史记录丢失`，优先类型为 `fix`/`feat`/`refactor`/`docs`/`chore`/`test`/`ci`。
- 标题应描述实际变更内容，建议不添加 `[codex]`、`codex`、`autocode`、`copilot` 或其他工具/agent 来源前缀。
- 该规范仅用于协作可读性与一致性提示，不应单独作为 review process blocker。

## 2.常用命令

```bash
npm install            # 安装依赖（axios + @larksuiteoapi/node-sdk）
npm start              # 启动常驻监控服务（盘中定时 + 19:00 收盘汇总）
npm run once           # 跑一次盘中流程后退出（调试用）
npm run probe          # 接口契约探针，打印原始响应核实数据源字段
npm run test:feishu    # 飞书凭证自检，发测试卡片验证 appId/appSecret/入群/权限
node tests/run_close_once.js   # 手动跑一次完整收盘流程（抓取→推送→写历史）
```

测试用 Node 内置 `node:test`，直接运行单测：

```bash
node tests/breadth.test.js   # 市场广度算法（涨跌停判定 / 广度统计）
node tests/crowd.test.js     # 拥挤度算法（前 5% 集中度 / level / delta）
node tests/screener.test.js  # 技术筛选算法（MA / 连续上涨 / 筛选）
```

## 3.项目架构

A 股大盘拥挤度监控：Node.js 22 常驻服务，盘中定时计算上证指数/创业板指的"大盘拥挤度"+"市场广度"并推送到飞书群，19:00 收盘汇总叠加融资融券余额、宽基 ETF 异动。

### 核心技术栈
- Node.js 22，**CommonJS**（飞书 SDK 是 CJS-first，避免 ESM interop）
- `axios`（数据拉取 + 反爬重试）、`@larksuiteoapi/node-sdk`（飞书 App Bot 推送）
- `https-proxy-agent`（可选，需代理时装）
- JSON 文件存储、进程内定时器调度（无 cron）
- Web 面板：单文件 HTML + Vue 3（global build）+ ECharts，零构建

### 入口与生命周期
- [service.js](service.js)：bootstrap 入口。loadConfig → createLogger → createHttpClient → createFeishuClient → `feishu.sendTest()` → createScheduler → start。支持 `--once` 跑一次盘中流程退出。信号 SIGINT/SIGTERM 优雅关闭；uncaughtException/unhandledRejection 记错不退出。

### 模块职责（`lib/`）
| 模块 | 职责 |
|------|------|
| [core/config.js](lib/core/config.js) | 加载 + 校验 config.json，fail-fast（飞书凭证非空等） |
| [core/log.js](lib/core/log.js) | stdout + 文件日志，index.log 超 10MB 轮转，error 额外写 error.log；控制台默认只输出 ERROR |
| [core/http.js](lib/core/http.js) | 共享反爬 HTTP 客户端：随机 UA / 限速 / 退避重试 / 456 快速失败降级 |
| [core/calendar.js](lib/core/calendar.js) | 交易日/时段/午休判断，读 `data/holidays.json` |
| [core/scheduler.js](lib/core/scheduler.js) | setTimeout 递归调度（非 setInterval，避免漂移），盘中点 + 19:00 |
| [data/](lib/data/) | 数据源策略模式：`base.js`(BaseFetcher) + `manager.js`(FetcherManager) + `breakers.js`(CircuitBreaker) + 各 fetcher（allA/indexQuote/margin/kline），按 capability 路由 + 自动 failover + 熔断 |
| [emData.js](lib/emData.js) | 东财字段/常量 + 纯函数工具（toSecid/num/parseDiffRows/isEmBlocked/deriveConstituents/fetchBShares） |
| [algo/crowd.js](lib/algo/crowd.js) | 拥挤度算法（纯函数）：前 5% 成交额集中度 / level / delta |
| [algo/breadth.js](lib/algo/breadth.js) | 市场广度（纯函数）：涨跌家数 / 涨跌停（按板块限幅）/ 总成交额 + 活跃度分级 |
| [algo/screener.js](lib/algo/screener.js) | 技术筛选：连续 3 日涨 且 现价 ≥ 5 日线 > 10 日线 |
| [margin.js](lib/margin.js) | 融资融券卡片数据格式化（含较前日变动） |
| [etfFlow.js](lib/etfFlow.js) | 宽基 ETF 成交额异动（国家队代理）：白名单逐只跟踪放大倍数 |
| [kline.js](lib/kline.js) | 日K纯函数（parseTencent/parseSina/meanOfLast）+ MA20 数据提供者（走 FetcherManager） |
| [store/priceHistory.js](lib/store/priceHistory.js) | 收盘价快照积累 + 技术筛选数据源 + 精筛结果落盘（供 Web 面板直读） |
| [store/history.js](lib/store/history.js) | JSON 历史读写（按年分文件 / 校验 / 备份 / 每周五 compact） |
| [view/cardBuilder.js](lib/view/cardBuilder.js) | 飞书卡片 JSON 组装（盘中 / 收盘 / 数据异常告警，column_set 多列表格） |
| [view/feishu.js](lib/view/feishu.js) | 飞书 SDK 客户端：发卡片 / 上传图片 / 失败回退 text / 重试 |
| [view/web.js](lib/view/web.js) | Web 面板 API + 静态文件伺服（node:http，零依赖） |
| [runner.js](lib/runner.js) | 编排：runIntraday / runClose 调用各模块 |

### 数据流
- **盘中快照**（10:00/11:00/14:00）：FetcherManager(`allA`) 抓全 A + 派生成分股 + B 股 → 算 breadth + 各指数 crowding → 内存取上一快照 delta → 建卡 → 推送
- **收盘汇总**（19:00）：上述 + FetcherManager(`margin`/`etfQuote`) → 算全指标 → 读近 30 收盘 + prevClose → 建卡（含融资表/ETF 表/30 日表）→ 推送 → 写收盘记录

### Web 面板
[web/index.html](web/index.html) 单文件 Vue 3 + ECharts 应用，四个 tab：概览（拥挤度历史曲线）、筛选（技术筛选命中，支持板块/价格/关注三维前端筛选，关注列表服务端存储跨设备同步）、个股（收盘价 + MA5/MA10）、配置（在线编辑 config.json + 手动触发收盘汇总）。后端 [view/web.js](lib/view/web.js) 提供 API：
- `GET /api/indices/history?days=60` → `{dates, sh, cy}`
- `GET /api/intraday?date=today` → 当日盘中快照轨迹
- `GET /api/stock/{code}?days=60` → `{code, name, days, series}`（series 含 close/ma5/ma10）
- `GET /api/screener?upDays=3` → `{count, readyDays, neededDays, updatedAt, items}`（优先读收盘落盘，无缓存时回退实时计算）
- `GET|POST /api/watchlist` → 关注列表（纯代码数组，服务端 `data/watchlist.json`，跨设备同步）
- `GET|POST /api/config` → 配置读写（GET 时 appSecret 脱敏为 `***`，POST 深合并写回 config.json，保存后需重启生效）
- `POST /api/run-close` → 手动触发完整收盘流程（防重入，异步执行，立即返回 202）

### 数据与存储
- `data/holidays.json`：静态节假日表（手工维护当年）
- `data/history/YYYY.json`：收盘记录按年分文件
- `data/history_backup/`：写入前自动备份
- `data/price_history/`：收盘价快照积累 + `screener_result.json`（精筛结果）
- `data/watchlist.json`：关注列表（纯代码数组，Web 面板读写）
- `logs/index.log` + `logs/error.log`：运行/错误日志（`logDir` 可配置，控制台默认只输出 ERROR）

### 配置
`config.json`（gitignore，从 `config.sample.json` 复制）控制飞书凭证、指数、阈值、推送模式、快照点、ETF 白名单、历史存储等。新增配置项必须同步更新 `config.sample.json`。

设计思路详见 [docs/design.md](docs/design.md)，变更记录见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。
