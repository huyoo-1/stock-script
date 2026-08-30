# 变更记录

## [Unreleased]

> ⚠️ 未验证：以下变更尚未经完整实盘验证，计划周末验证。
- [新功能] 日志支持 `logDir`/`logConsoleLevel` 配置：普通日志写入 `index.log`，控制台默认只输出 ERROR，减少分页抓取日志刷屏
- [新功能] MA20 精筛增加北交所熔断：窗口内北交所日K失败频率过高时自动跳过，避免精筛长时间卡住
- [文档] 同步更新 design.md 至代码现状：目录结构、配置项、数据源策略模式、Web 面板、技术筛选 MA20 精筛、黄金走势
- [修复] Web 筛选列表虚拟滚动初始化高度测量错误，切 tab 后只能滚动一页，增加 ResizeObserver 与滚动时高度回写
- [改进] runClose 与 Web 手动收盘增加非交易日跳过保护，避免周末/节假日触发覆盖最近一个交易日的有效筛选与收盘数据
- [新功能] 新增黄金走势 Web 面板：收盘后抓取伦敦金现货金价（hf_XAU）+ 黄金龙头股与黄金 ETF 收盘价，双 Y 轴叠加走势图，按日存储可回看（30/60/120 日）
- [新功能] 技术筛选升级为两级：本地 10 日粗筛（连续 3 日涨 + 现价≥MA5>MA10）→ 数据源日 K 二次精筛（现价≥MA20 且 MA5>MA10>MA20），Web 面板/收盘卡片只展示多头趋势个股
- [新功能] 新增腾讯日 K 数据源（主源）与新浪日 K 兜底，`config.screener` 可配置 `ma20Source` / `ma20Days` / `concurrency` / `cacheTtlMs`，默认 `auto`（腾讯→新浪）
- [新功能] 引入数据源策略模式（BaseFetcher + FetcherManager + CircuitBreaker），数据抓取改为配置化优先级路由 + 自动 failover + 熔断
- [改进] FetcherManager 按 capability 路由数据源，调指数行情不再误试全A fetcher
- [改进] MA20 精筛接入 FetcherManager，日K抓取统一走策略模式
- [改进] 目录整理：数据源策略模块放 lib/data/，测试拆分为 tests/unit/ 和 tests/scripts/
- [改进] 精简 emData/margin/kline 旧 fetch 实现，删除死代码与重复的 WAF 冷却逻辑
- [改进] kline.js 域名级 WAF 冷却抽象为通用 CircuitBreaker，修复 clearKlineCache 未清理 blockedHosts 的 bug
- [改进] lib/ 目录按职责分类：core/(基础设施) algo/(算法) store/(存储) view/(输出层)，data/ 已有
- [改进] 技术筛选结果收盘落盘，Web 面板 `/api/screener` 改为直读落盘，避免每次访问重算日K
- [新功能] Web 面板筛选页增加板块/价格/关注三维筛选（前端计算）
- [新功能] 关注列表迁移服务端存储（`data/watchlist.json`），Web 面板读写，跨设备同步
- [新功能] Web 面板新增配置 tab：在线编辑 config.json（飞书凭证脱敏显示），保存后提示重启生效
- [新功能] Web 面板新增手动触发收盘汇总按钮（带二次确认），复用 runClose 全流程
- [修复] 修复 lib/ 目录重构后 store/core 模块数据路径少一层 `..`，导致 holidays.json/watchlist.json/intraday.json/price_history/history 误写到 `lib/data/` 而非根 `data/`（节假日表静默失效、Web 面板静态文件 404）
- [修复] runner.js `allSource` 变量名错致完成日志恒打印 `(undefined)`，丢失数据源来源信息
- [修复] Web 配置保存后内存 `_config` 不刷新，连续保存会回退 appSecret 到启动初始值
- [改进] 收盘流程调整顺序：核心收盘记录（拥挤度/广度/margin/etf）先落盘，技术筛选降为附加步骤并 try/catch 兜底，避免半成品落盘致当日记录缺失
- [改进] 收盘附加数据改用 Promise.allSettled，任一子任务失败降级为空值不中断整个流程
- [改进] Web 触发收盘按钮加 5 分钟超时兜底，runClose 卡死时允许重试；前端 loading 态保持 90 秒防重复点击
- [改进] 关注列表保存失败不再静默，前端提示并保留原状态
- [改进] loadConfig/saveConfig 错误提示友好化，后端返回非 JSON 时不再抛 SyntaxError
- [修复] readIntraday/loadDay 校验非数组 JSON，损坏文件不再致 TypeError 或静默数据质量
- [改进] price_history 清理旧快照改按文件名日期而非 mtime，避免重跑刷新 mtime 致旧文件不被清
- [改进] /api/screener 有缓存时也认 upDays 参数，与请求不符时回退实时计算
- [修复] CHANGELOG 迁移至 docs/ 并改扁平格式
- [改进] `package.json` 的 `test` 脚本改为显式枚举测试文件，避免 Windows shell 不展开 `*.test.js` glob 导致 `npm test` 失败
- [修复] runner.js `runClose` 未传 `fetcherMgr` 的 fallback 导致 MA20 精筛被静默禁用
- [修复] 收盘黄金数据仅从全 A 快照 filter，配置的 ETF（如 518880/159934）无法命中而缺失
- [改进] 收盘黄金数据日志文案由"黄金股"改为"黄金股/ETF"，与配置语义一致
- [修复] `lib/kline.js` 的 `parseSinaKline` 按第一个 `=` 截断新浪 JSONP 响应，遇到返回开头的 `/*<script>...</script>*/` 注释时解析为空数组

## [v1.0.0] - 2026-08-11

首个正式版。盘中拥挤度 + 市场广度推送、收盘全指标汇总、飞书卡片、本地历史写入全链路跑通。

### 功能

- 盘中快照（10:00 / 11:00 / 14:00）：全 A 算广度 + 成分股算拥挤度，对比上一快照推送
- 收盘汇总（19:00）：叠加融资融券、ETF 异动、近 30 日趋势，推送并写历史
- 飞书消息卡片（`column_set` 多列表格），超长拆多卡，失败回退文本
- 本地历史按年分文件，写入前校验 + 备份，每周五自动整理

### 数据抓取

- 全量合并：只翻一次全 A（约 70 页），成分股按前缀筛出，请求量减半
- 主源新浪，备选东财；指数/ETF 行情走新浪，融资融券走东财
- 反爬：串行 + 随机间隔 / UA / Cookie / Referer，456 快速失败降级

### 算法

- 拥挤度：前 5% 成分股成交额占比
- 广度：涨跌家数 / 涨跌停（按板块）/ 总成交额 + 活跃度分级
- 融资融券：单侧缺失标 `partial`，不混 0
- 收盘价快照 + 技术筛选（连续 3 日涨 且 现价 ≥ 5 日线 > 10 日线）

### 发版前修复

- 日志轮转崩溃（`write after end`）
- `test:feishu` 脚本失效
- 历史配置未注入
- 新浪行情绕过统一 HTTP 客户端
- Web 默认绑定改 `127.0.0.1`

### 测试

`breadth/crowd/screener.test.js`（单测）+ `test-feishu.js` + `probe.js` + `run_close_once.js`。一次性调试脚本已清理。

### 已知限制

- 新浪高频抓取可能 456 封禁，5 分钟到几小时自解
- 深交所融资融券备选字段未核实
- 节假日表静态维护（仅 2026）
