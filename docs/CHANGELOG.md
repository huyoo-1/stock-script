# 变更记录

## [Unreleased]

## [v1.1.0] - 2026-09-13

Web 面板重构为 Vite + Vue 3 SFC + Element Plus 工程；数据抓取引入策略模式（failover + 熔断）；技术筛选升级为本地粗筛 + 日K精筛两级；新增黄金走势面板、配置在线编辑、一键启动脚本；日志拆分与北交所熔断。

### 新功能

- 新增 `run.bat` 一键启动脚本：自动检查依赖与 config.json、打印本机/局域网访问地址、调用 `npm start`（含 prestart 自动构建前端）
- 新增 `scripts/start-info.js`：启动前读 config.web 端口（不写死）+ 检测局域网 IPv4，控制台输出本机与局域网访问 URL，host=127.0.0.1 时提示改为 0.0.0.0 才能局域网访问
- 日志支持 `logDir`/`logConsoleLevel` 配置：普通日志写入 `index.log`，控制台默认只输出 ERROR，减少分页抓取日志刷屏
- MA20 精筛增加北交所熔断：窗口内北交所日K失败频率过高时自动跳过，避免精筛长时间卡住
- 新增黄金走势 Web 面板：收盘后抓取伦敦金现货金价（hf_XAU）+ 黄金龙头股与黄金 ETF 收盘价，双 Y 轴叠加走势图，按日存储可回看（30/60/120 日）
- 技术筛选升级为两级：本地 10 日粗筛（连续 3 日涨 + 现价≥MA5>MA10）→ 数据源日 K 二次精筛（现价≥MA20 且 MA5>MA10>MA20），Web 面板/收盘卡片只展示多头趋势个股
- 新增腾讯日 K 数据源（主源）与新浪日 K 兜底，`config.screener` 可配置 `ma20Source` / `ma20Days` / `concurrency` / `cacheTtlMs`，默认 `auto`（腾讯→新浪）
- 引入数据源策略模式（BaseFetcher + FetcherManager + CircuitBreaker），数据抓取改为配置化优先级路由 + 自动 failover + 熔断
- Web 面板筛选页增加板块/价格/关注三维筛选（前端计算）
- 关注列表迁移服务端存储（`data/watchlist.json`），Web 面板读写，跨设备同步
- Web 面板新增配置 tab：在线编辑 config.json 全量字段（飞书凭证脱敏显示），保存后提示重启生效
- Web 面板新增手动触发收盘汇总按钮（带二次确认），复用 runClose 全流程

### 改进

- Web 面板 UI 全面迁移到 Element Plus 组件库：外壳菜单/按钮/输入/选择/标签/卡片/表单/消息框改用 el-* 组件，@element-plus/icons-vue 替换 emoji 图标，unplugin-vue-components/unplugin-auto-import 按 ElementPlusResolver 组件按需自动导入（CSS/图标全量）
- 筛选页保留手写虚拟滚动（已验证移动端纵向堆叠布局），行内 ★关注按钮/板块标签/筛选 chips 换为 el-button/el-tag/el-radio-group/el-checkbox
- Web 面板从单文件 HTML 迁移到 Vite + Vue 3 SFC 工程，按 tab 拆分为独立视图组件与 composables（useChart/useApi/useScreenerFilter/useWatchlist/useScreener）
- 新增 npm run dev（concurrently 同时启动 Vite + Node，Vite 端口 8089 起、被占自动递增，代理 /api 且目标从 config.json 的 web.host/web.port 读）、npm run build（Vite 构建 web/dist）、prestart 钩子（dist 不存在时自动构建）
- lib/view/web.js serveStatic 改为伺服 web/dist，新增 .mjs/.woff2 等 MIME、SPA fallback、dist 缺失 503 提示、assets/ 长缓存
- Web 面板整体重构：桌面端改为侧边栏+顶栏+内容区三栏布局，触屏设备（iPhone/iPad）改为底部 tabbar，按 `hover`/`pointer` 媒体查询区分设备类型而非纯像素宽度，适配管理系统交互模式
- Web 配置页补齐缺失字段编辑能力：新增监控指数、黄金股/ETF、控制台日志级别、日志目录、HTTP 代理、nid18、北交所熔断参数、历史目录/备份目录等字段
- Web ECharts 生命周期：图表容器改用 ResizeObserver 监听尺寸变化，切 tab 容器可见后自动初始化/resize，onUnmounted 补 dispose
- Web 概览页新增当日盘中轨迹图（复用 `/api/intraday`），桌面端与拥挤度曲线并排双列，触屏端堆叠
- prestart 拆为 `scripts/prestart-build.js`：vite 未安装或前端构建失败时只提示不阻断后端启动（面板回落 503），run.bat 依赖检查改为同时探测 `node_modules\vite`
- vite.config.mjs dev 代理目标改为读 `config.json` 的 `web.host`/`web.port`（不写死 8787），unplugin 显式 `dts: false`；dev 端口 8089 起、被占自动递增
- runClose 与 Web 手动收盘增加非交易日跳过保护，避免周末/节假日触发覆盖最近一个交易日的有效筛选与收盘数据
- FetcherManager 按 capability 路由数据源，调指数行情不再误试全A fetcher
- MA20 精筛接入 FetcherManager，日K抓取统一走策略模式
- 目录整理：数据源策略模块放 lib/data/，测试拆分为 tests/unit/ 和 tests/scripts/
- 精简 emData/margin/kline 旧 fetch 实现，删除死代码与重复的 WAF 冷却逻辑
- kline.js 域名级 WAF 冷却抽象为通用 CircuitBreaker，修复 clearKlineCache 未清理 blockedHosts 的 bug
- lib/ 目录按职责分类：core/(基础设施) algo/(算法) store/(存储) view/(输出层)，data/ 已有
- 技术筛选结果收盘落盘，Web 面板 `/api/screener` 改为直读落盘，避免每次访问重算日K
- 收盘流程调整顺序：核心收盘记录（拥挤度/广度/margin/etf）先落盘，技术筛选降为附加步骤并 try/catch 兜底，避免半成品落盘致当日记录缺失
- 收盘附加数据改用 Promise.allSettled，任一子任务失败降级为空值不中断整个流程
- Web 触发收盘按钮加 5 分钟超时兜底，runClose 卡死时允许重试；前端 loading 态保持 90 秒防重复点击
- 关注列表保存失败不再静默，前端提示并保留原状态
- loadConfig/saveConfig 错误提示友好化，后端返回非 JSON 时不再抛 SyntaxError
- price_history 清理旧快照改按文件名日期而非 mtime，避免重跑刷新 mtime 致旧文件不被清
- /api/screener 有缓存时也认 upDays 参数，与请求不符时回退实时计算
- `package.json` 的 `test` 脚本改为显式枚举测试文件，避免 Windows shell 不展开 `*.test.js` glob 导致 `npm test` 失败
- 收盘黄金数据日志文案由"黄金股"改为"黄金股/ETF"，与配置语义一致

### 修复

- Web 筛选页 H5 窄屏数据重叠：row 改纵向堆叠布局，row-nums 加 flex-wrap 兜底，虚拟滚动 itemHeight 从 56 调整为 72
- Web 配置页校验错误不可读：错误展示从胶囊样式改为多行警告框，后端 400 响应额外返回 errors 数组，前端渲染为列表逐条展示
- Web 概览盘中轨迹图无法渲染：后端 `date=today` 无盘中数据时回退到最近有数据的交易日；前端从 record.indices 按 code 取拥挤度，修正原先读取不存在的 sh/cy 字段致图表空白
- Web 概览双列布局窄屏横向溢出：overview-grid 的 1fr 改为 minmax(0,1fr)，避免图表 canvas 内容撑破网格轨道
- Web 触发收盘被拒绝时只显示「请求失败（400）」：useApi.postJson 错误信息优先取服务端 `error`/`message` 字段（如「非交易日，已跳过收盘流程」）
- Web 筛选列表虚拟滚动初始化高度测量错误，切 tab 后只能滚动一页，增加 ResizeObserver 与滚动时高度回写
- 修复 lib/ 目录重构后 store/core 模块数据路径少一层 `..`，导致 holidays.json/watchlist.json/intraday.json/price_history/history 误写到 `lib/data/` 而非根 `data/`（节假日表静默失效、Web 面板静态文件 404）
- runner.js `allSource` 变量名错致完成日志恒打印 `(undefined)`，丢失数据源来源信息
- Web 配置保存后内存 `_config` 不刷新，连续保存会回退 appSecret 到启动初始值
- readIntraday/loadDay 校验非数组 JSON，损坏文件不再致 TypeError 或静默数据质量
- runner.js `runClose` 未传 `fetcherMgr` 的 fallback 导致 MA20 精筛被静默禁用
- 收盘黄金数据仅从全 A 快照 filter，配置的 ETF（如 518880/159934）无法命中而缺失
- `lib/kline.js` 的 `parseSinaKline` 按第一个 `=` 截断新浪 JSONP 响应，遇到返回开头的 `/*<script>...</script>*/` 注释时解析为空数组

### 文档

- 同步更新 design.md 至代码现状：目录结构、配置项、数据源策略模式、Web 面板、技术筛选 MA20 精筛、黄金走势
- 修正 design.md 与实现不一致处：dev 端口 8089、`vite.config.mjs` 文件名、依赖版本对齐 package.json、按需导入措辞
- CHANGELOG 迁移至 docs/ 并改扁平格式

### chore

- 新增 devDependencies：element-plus、@element-plus/icons-vue、unplugin-vue-components、unplugin-auto-import；tokens.css 删除被 EP 替代的组件 CSS，保留布局/主题 token/图表高度/设备媒体查询，收紧全局 reset 避免 EP 组件内边距被剥
- 新增 devDependencies：vite、@vitejs/plugin-vue、vue、concurrently；删除 web/vendor/vue.global.prod.js（SFC 工程用 npm vue）

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
