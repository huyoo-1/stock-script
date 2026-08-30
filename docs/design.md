# A 股大盘拥挤度监控脚本 —— 设计文档

## 1. 项目概述

- **项目名称**：A 股大盘拥挤度监控
- **目标**：以 Node 本地常驻服务形式运行，盘中每小时定时计算上证指数、创业板指的“大盘拥挤度”与“市场广度”并推送，收盘后（19:00）再推送一次全天汇总，结果均推送到飞书群（消息卡片，原生表格）。
- **实现语言**：JavaScript（Node.js）
- **运行策略**：先文档，后编码；本文档确认后再进入代码实现阶段。

***

## 2. 核心指标定义

### 2.1 大盘拥挤度

> **大盘拥挤度** = 全 A 成交额排名前 5% 的个股中属于该指数的成交额之和 / 该指数全部有效成分股成交额之和 × 100%

该指标用于衡量市场交易集中度和微观结构健康状况。

> 口径说明（2026-08-02 修正，与同花顺/通达信等主流软件"大盘拥挤度"口径一致）：分子取全 A 前 5% 热门股中属于该市场的部分，而非该市场内部前 5%，详见 §2.3。

### 2.2 阈值含义

| 拥挤度范围      | 状态  | 含义                        |
| ---------- | --- | ------------------------- |
| < 40%      | 正常  | 市场交易分散，微观结构健康             |
| 40% \~ 50% | 关注区 | 交易集中度上升，需关注局部过热           |
| ≥ 50%      | 预警区 | 历史上突破后常伴随市场反转或风格切换，顶部预警信号 |

### 2.3 指数维度

由于上证指数和创业板指成分股不同，拥挤度需要分别计算（口径 2026-08-02 修正）：

- 拉取全 A 股当日行情（含成交额），按成交额降序；
- 取全 A 前 5% 股票：`topCount = Math.max(1, Math.ceil(totalCount * 0.05))`；
- **分子** = 全 A 前 5% 中属于该市场的股票成交额之和（上证按 `market === 0` 判定，创业板按代码 `30` 开头判定）；
- **分母** = 该市场全部有效股票成交额之和（过滤停牌 / 成交额为 0）；
- 拥挤度 = 分子 / 分母 × 100%，保留两位小数。

成分股与全 A 数据同源：由同一批全 A 数据按市场 + 代码前缀派生（`deriveConstituents`），保证分子分母口径一致，避免两批独立抓取带来的成交额时点偏差（2026-08-08 重构）。

### 2.4 融资融券余额

> **融资融券余额** = 融资余额 + 融券余额（沪深两市合计，单位：亿元）

该指标用于跟踪全市场杠杆资金动向：融资余额上升代表做多杠杆资金净流入，融券余额上升代表做空力量增强。两者合计反映杠杆资金整体规模与情绪。

- 数据为**盘后统计型**，交易所约 T 日 18:00 发布当日数据，第三方（东方财富）18:00–19:00 转发；
- 盘中无实时更新，故仅在 19:00 收盘汇总中推送。

### 2.5 国家队 ETF 成交额异动（代理指标）

> **国家队 ETF 成交额异动** = 宽基 ETF 当日成交额较前一日的放大倍数（白名单逐只跟踪）

用于监控“国家队”（中央汇金、证金、社保等）通过宽基 ETF 稳定市场的动向。由于国家队主体不披露精确增减持金额，本指标定位为**代理指标**，数据可得性边界如下：

- **可得**：宽基 ETF 每日成交额（行情接口标准字段，免费、日频，无需 F12 抓包份额字段）；
- **不可得**：国家队主体的精确增减持金额（汇金公告仅定性无金额、证金/社保不披露、ETF 前十大持有人半年才更新且无变动金额）。

代理逻辑：

- 监控宽基 ETF 白名单（如 510300 沪深 300、510050 上证 50、510500 中证 500、510310、159915 创业板）；
- 计算当日成交额 / 前一日成交额的放大倍数；当日成交额较前一日异常放大（达到 2–3 倍及以上）→ 打“疑似国家队”标签；
- 结合汇金官网公告时间点做事件标注（公告仅定性，无金额）。

> ⚠️ 成交额反映二级市场交易活跃度，与份额变动（一级市场申赎）信号含义不同：国家队大额申赎会带动成交额放大，但成交额放大也可能由其他资金引起，故标签为“疑似”，非国家队主体精确操作。

### 2.6 市场广度

> **市场广度** = 全市场涨跌家数、涨跌停家数、两市总成交额三项盘面统计，用于衡量“赚钱效应是否扩散”。

拥挤度衡量“钱往少数票集中”，市场广度衡量“赚钱效应是否扩散”，两者**互补不替代**：

- 拥挤度高 + 广度低 → 头部抱团、多数票不涨，风险偏高；
- 拥挤度低 + 广度高 → 交易分散、普涨，微观结构健康。

**统计项**：

| 统计项             | 含义                      | 口径              |
| --------------- | ----------------------- | --------------- |
| 涨家数 / 跌家数 / 平家数 | 当日上涨/下跌/平盘的个股数量（沪深两市合计） | 盘中为实时累计，收盘为全天定值 |
| 涨停家数 / 跌停家数     | 当日触及涨停/跌停的个股数量          | 同上              |
| 两市总成交额          | 沪深两市当日成交额合计（亿元）         | 盘中为当日累计，收盘为全天   |

**活跃度分级**（按两市总成交额）：

| 两市总成交额    | 活跃度  | 说明             |
| --------- | ---- | -------------- |
| ≥ 15000 亿 | 高活跃度 | 资金参与度高，常伴随主线行情 |
| ≥ 9000 亿  | 中等活跃 | 正常交投           |
| < 9000 亿  | 缩量观望 | 交投清淡，趋势性弱      |

- 数据均可从东方财富行情接口获取（涨跌家数、涨跌停家数、总成交额均为标准盘面字段），无额外数据成本；
- 盘中快照与收盘汇总均推送市场广度。

***

## 3. 监控标的

| 指数名称 | 指数代码   | 交易所     |
| ---- | ------ | ------- |
| 上证指数 | 000001 | 上海证券交易所 |
| 创业板指 | 399006 | 深圳证券交易所 |

***

## 4. 数据源

### 4.1 主数据源

数据抓取通过 `lib/data/manager.js` 的 `FetcherManager` 按 capability 统一路由，各源按优先级自动 failover（详见 §11.1）。

- **新浪财经**：当前网络下最稳定，作为行情主源。
  - 全 A 分页接口 `vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData`（一次抓全 A 约 70 页 / 5500+ 只），指数/ETF 行情走 `hq.sinajs.cn` 单请求；
  - **成分股与全 A 同源**：成分股从同一批全 A 数据按市场 + 代码前缀派生，避免拥挤度分子分母口径不一致（见 §2.3）；
- **东方财富（EM）**：作为行情备选；融资融券主源。
  - `datacenter-web.eastmoney.com`（reportName=`RPTA_WEB_MARGIN_DAILYTRADE`，直出沪深合计余额）——**融资融券主源**，实测可用；
  - `push2.eastmoney.com` 行情接口（clist/get 全 A 大包、stock/get 指数/ETF）——当前网络下必 `socket hang up`，仅作新浪失败时的兜底；
- **腾讯财经**：日 K 数据源，作为 MA20 精筛主源（`web.ifzq.gtimg.cn`），新浪日 K 兜底。
- 接口形式：HTTP JSON / JSONP 接口，通过 `axios` 请求（见 §8 技术选型）。

### 4.2 备选数据源

| 数据源                                         | 说明                                  |
| ------------------------------------------- | ----------------------------------- |
| 东方财富（EM）                                   | 行情接口当前网络不稳定，仅作新浪失败时的兜底；`datacenter` 融资融券接口可用 |
| 腾讯财经                                        | 提供简单的行情接口，可作为成交额备选                   |
| 同花顺 iFinD / Tushare / Wind                  | 稳定性更高，但可能需要授权或付费                    |
| 上交所官方（`query.sse.com.cn`）                   | 融资融券沪市数据，单位为**元**，需 Referer，可作交叉校验  |
| 深交所官方（`szse.cn/api/report/ShowReport/data`） | 融资融券深市数据，单位为**亿元**，需 Referer，可作交叉校验（字段待核实） |

### 4.3 数据源选择原则

- 优先使用新浪财经（当前网络稳定），免费且覆盖全 A、指数/ETF、B 股行情；
- 融资融券优先东财 `datacenter`，失败时降级上交所 + 深交所官方接口交叉校验（注意沪市单位为元、深市为亿元，合计前统一换算；深交所字段待核实，解析不到时标记缺失而非按 0 计算）；
- 日 K 优先腾讯，腾讯被 WAF 封禁时自动降级新浪；
- 数据源切换通过 `lib/data/manager.js` 的 `FetcherManager` 配置化完成，新增源只需实现 `BaseFetcher` 并注册到 `service.js`；
- 所有源均失败时，推送"数据异常"告警卡，当日该指标标记为缺失，不推送全 0 假数据。

### 4.4 国家队 ETF 数据可得性说明

国家队 ETF 增减持**无法直接获得主体精确金额**，公开渠道可得性如下：

- 汇金官网公告：不定期、仅定性（“已增持 XX ETF”），无金额、无份额明细；
- 证金 / 社保：基本不披露 ETF 持仓；
- ETF 前十大持有人：半年披露一次（中报 + 年报），严重滞后且无变动金额。

因此本项目采用**代理方案**：监控宽基 ETF 每日成交额（行情接口标准字段），对当日成交额较前一日异常放大（2–3 倍及以上）者打“疑似国家队”标签，并标注汇金公告事件。详见 2.5 节。

### 4.5 反爬策略

东方财富、新浪等免费行情接口无 API Key，但会按 IP / 频率 / UA 做风控，高频或固定特征请求易被限流（返回空数据、403、或延迟数据）。本项目拉取频率低（盘中 3 次 + 收盘 1 次/天），但仍需基础反爬手段保障长期稳定：

| 手段            | 说明                                                         |
| ------------- | ---------------------------------------------------------- |
| 请求间隔 / 限速     | 同一源连续请求间加随机间隔，分页抓取**全为串行**（全 A 1.2–2.5s），避免短时连发 / 并发翻页触发限流 |
| 随机 User-Agent | 每次请求从 UA 池随机取一个，避免固定 UA 被识别；UA 池内置常量，无需依赖                  |
| 随机 Referer / Cookie | 新浪请求自动带随机 `Referer`（多个财经页面）与随机 `Cookie`，降低被识别为脚本的概率 |
| 指数退避重试 + 封禁快速失败 | 普通失败按 1s/3s/8s 退避重试 `maxRetries` 次，退避时长加随机抖动（jitter），避免惊群；**456（新浪 IP 级封禁）立即失败并降级，不重试**（重试无意义且加剧封禁）；403/503 走更长冷却（5–10s）再重试 |
| 域名级熔断 | `CircuitBreaker` 对连续失败或 WAF/封禁响应（501、456）的域名进行冷却，避免反复请求已不可用的源；配置见 `config.dataSources.circuitBreaker` |
| 多源故障转移        | 主源（新浪）失败或返回空时，降级到东财大包 / 备选源（见 4.3），不卡死单源                     |
| 合理 Referer    | 部分接口（上交所/深交所融资融券）需带 `Referer` 才返回数据，按源配置                   |
| 请求头贴近浏览器      | 带 `Accept`/`Accept-Language`/`Connection` 等常规头，降低被识别为脚本的概率 |

> 以上手段基于 `axios` + `lib/data/breakers.js` 的 `CircuitBreaker` 实现：`http.js` 负责随机 UA / 限速 / 请求头 / 退避重试；`CircuitBreaker` 负责域名级 WAF/封禁冷却（501 腾讯 WAF、456 新浪封禁立即熔断）。反爬强度按“够用即可”，不做代理池 / 验证码破解等重度对抗。实测单次全量抓取（约 70 页串行）未触发 456。

***

## 5. 推送规则

### 5.1 推送频率

系统以常驻进程运行，内部用定时器自管调度，支持两种推送模式（由 `config.mode` 控制，默认 `both`）：

- **盘中快照**：交易时段内每小时计算并推送一次。默认快照点为 **10:00、11:00、14:00**（共 3 次）。
  - 跳过 9:30（开盘数据过少）、13:00（午休后累计成交额与 11:30 相同）两点信息冗余时点；
  - 各时间点写入 `config.intradayPoints` 可配置，如需更密可追加 13:00、15:00；
  - 非交易日、午休时段（11:30–13:00）自动跳过。
- **收盘汇总**：每日 **19:00** 推送一次全天汇总（由 `config.closeTime` 控制，格式 `HH:mm`）。
  - 选 19:00 而非 15:05：融资融券余额为盘后统计型数据，交易所约 18:00 才发布当日数据，东方财富 18:00–19:00 转发；15:05 拉取只能拿到 T-1 数据，与当日拥挤度/ETF 口径错位。19:00 留足缓冲，三个指标同日口径齐全。

> A 股交易时间为 9:30–11:30、13:00–15:00。

### 5.2 推送内容

按模式区分两类消息模板：

**盘中快照消息**包含：

1. 当前日期 + 快照时间；
2. 上证指数、创业板指当前拥挤度及预警级别；
3. 较上一快照的变化（↑/↓ 及百分点差值，首个快照无对比）；
4. 市场广度：涨跌家数、涨跌停家数、两市总成交额及活跃度分级；
5. 简短提示（如是否进入关注区/预警区）。

**收盘汇总消息**包含：

1. 当前日期；
2. 上证指数、创业板指当日拥挤度及预警级别；
3. 市场广度：涨跌家数、涨跌停家数、两市总成交额及活跃度分级；
4. 融资融券余额（融资余额 / 融券余额 / 合计，单位亿元，较前日变动）；
5. 宽基 ETF 成交额异动（白名单逐只当日成交额及较前一日放大倍数，超阈值者标“疑似国家队”）；
6. 最近 30 个交易日的拥挤度对比表格；
7. 关键结论与风险提示。

**数据异常告警**：任一关键数据（全 A 行情）所有数据源均失败时，推送"数据异常"告警卡（`buildErrorCard`），标明失败原因，不推送全 0 / 未知的假数据。

### 5.3 推送渠道

- **飞书应用机器人（App Bot）**：通过官方 SDK `@larksuiteoapi/node-sdk` 推送，需在飞书开放平台后台创建自建应用，获取 `app_id` / `app_secret`，并将应用机器人加入目标群获得 `chat_id`；
- 消息类型以**消息卡片（`msg_type: "interactive"`）**为主，辅以 `text` 兜底；
- **鉴权**：App Bot 模式由 SDK 自动获取并刷新 `tenant_access_token`，**无需手写加签**（区别于 webhook 自定义机器人的 HMAC 加签）；
- **富文本能力**：飞书消息卡片支持标题、多列布局（`column_set`/`column`，可画真表格）、分割线、加粗、列表、**图片**（`img` 元素，需先上传得 `image_key`）、按钮等；详见 11.4 能力边界。
- > 选 App Bot 而非 webhook 自定义机器人：webhook 模式不支持图片/附件上传，且需手写 HMAC 加签；App Bot 经 SDK 鉴权更省心，且支持图片（30 日走势图）与附件，富文本能力完整。代价是需在后台建应用（一次性配置）。

***

## 6. 系统架构

```
Node 常驻服务（service.js，开机自启 + 崩溃自动拉起）
           │
           ├── 内部定时器自管调度
           │     ├── 交易时段内（10:00 / 11:00 / 14:00）→ 盘中快照
           │     └── 19:00 → 收盘汇总
           │
           ▼
    ┌──────────────┐
    │  FetcherManager（数据源策略模式）  │
    └──────────────┘
           │
           ├── 全 A 行情（allA）：新浪分页 → 东财大包
           ├── 指数 / ETF 行情（indexQuote/etfQuote）：新浪 → 东财
           ├── 融资融券（margin）：东财 datacenter → 交易所官方
           ├── 日 K（kline）：腾讯 → 新浪（MA20 精筛用）
           └── 伦敦金现货（goldPrice）：新浪 hf_XAU
           │
           ▼
    ┌──────────────┐
    │   计算主流程  │  runIntraday / runClose（lib/runner.js）
    └──────────────┘
           │
           ├── 成分股按市场 + 代码前缀派生（与全 A 同源）
           ├── B 股成交额（计入两市总成交额）
           ├── 市场广度（涨跌家数 / 涨跌停 / 总成交额）
           ├── 大盘拥挤度（前 5% 集中度）
           ├── 融资融券 + ETF 异动（仅收盘）
           └── 技术筛选 + 黄金数据落盘（收盘附加步骤）
           │
           ▼
    ┌──────────────┐
    │   数据落地    │  history / priceHistory / goldHistory / watchlist
    └──────────────┘
           │
           ▼
    ┌──────────────┐     ┌────────────────┐
    │  飞书消息推送  │     │   Web 面板      │
    └──────────────┘     └────────────────┘
     盘中/收盘/告警卡片      Vue 3 + ECharts，默认 127.0.0.1:8787
```

核心数据流：

- **盘中快照**：FetcherManager 按 capability 路由拉取全 A → 派生成分股 + B 股 → 算广度 + 拥挤度 → 与内存上一快照对比 delta → 推送飞书卡片，同时落盘 `data/intraday.json`。
- **收盘汇总**：核心行情抓取同盘中 → `Promise.allSettled` 并行融资融券 / ETF / 指数行情 → 核心收盘记录先落盘 → 附加步骤（收盘价快照、黄金数据、技术筛选）落盘 → 推送收盘卡片 → 周五自动 compact。
- **Web 面板**：独立 `node:http` 服务，读取上述落盘数据做历史曲线、个股走势、筛选列表、黄金叠加图、配置管理、手动收盘触发。

***

## 7. 文件结构

```
stock-script/
├── docs/
│   ├── design.md              # 本文档
│   └── CHANGELOG.md           # 变更记录
├── config.json                # 运行配置（飞书、指数、阈值、模式、快照点、存储）
├── config.sample.json         # 配置模板
├── service.js                 # 常驻服务入口：bootstrap + 数据源注册 + 调度 + Web 面板
├── lib/
│   ├── core/                  # 基础设施
│   │   ├── config.js          # 配置加载与校验（fail-fast）
│   │   ├── scheduler.js       # 定时调度（setTimeout 递归锚定 HH:MM，交易日/时段判断）
│   │   ├── calendar.js        # 交易日历判断（节假日 / 周末 / 交易时段）
│   │   ├── http.js            # 共享反爬 HTTP 客户端（随机 UA / 限速 / 退避重试 / 456 快速失败）
│   │   └── log.js             # 双输出日志（文件全量 + 控制台按级别过滤，10MB 轮转）
│   ├── data/                  # 数据源策略模式
│   │   ├── base.js            # BaseFetcher 契约
│   │   ├── manager.js         # FetcherManager：按 capability 路由 + 优先级 + failover
│   │   ├── breakers.js        # CircuitBreaker：域名级 WAF/封禁冷却
│   │   ├── allA.js            # 全 A 行情 fetcher（新浪分页 / 东财大包）
│   │   ├── indexQuote.js      # 指数 / ETF 行情 fetcher（新浪 / 东财）
│   │   ├── margin.js          # 融资融券 fetcher（东财 datacenter / 交易所官方）
│   │   ├── kline.js           # 日 K fetcher（腾讯 / 新浪，MA20 精筛用）
│   │   └── goldPrice.js       # 伦敦金现货 fetcher（新浪 hf_XAU）
│   ├── algo/                  # 纯函数算法
│   │   ├── crowd.js           # 拥挤度计算（前 5% 集中度 / level / delta）
│   │   ├── breadth.js         # 市场广度（涨跌家数 / 涨跌停 / 总成交额 + 活跃度分级）
│   │   └── screener.js        # 技术筛选（本地 MA5/MA10 粗筛 + 日 K MA20 二次精筛）
│   ├── store/                 # JSON 文件存储
│   │   ├── history.js         # 收盘 / 盘中历史读写（按年分文件 / 缓存 / 备份 / 自动整理）
│   │   ├── priceHistory.js    # 收盘价快照积累 + 精筛结果落盘
│   │   ├── goldHistory.js     # 金价 + 黄金股 / ETF 按日存储
│   │   └── watchlist.js       # 关注列表服务端存储（跨设备同步）
│   ├── view/                  # 输出层
│   │   ├── cardBuilder.js     # 飞书卡片 JSON 组装（column_set 表格 / 数据异常告警卡）
│   │   ├── feishu.js          # 飞书 SDK 推送封装（App Bot / 卡片 / 图片 / 失败回退 text）
│   │   └── web.js             # Web 面板 API + 静态文件伺服（node:http，零依赖）
│   ├── emData.js              # 东财字段/常量 + 解析纯函数 + 成分股派生 + B 股抓取
│   ├── kline.js               # 日 K 解析纯函数 + createMa20Provider（带 TTL 缓存）
│   ├── margin.js              # 融资融券格式化（含较前日变动）
│   └── etfFlow.js             # 宽基 ETF 成交额异动 + 疑似国家队标签
├── tests/
│   ├── unit/                  # 单测（node --test）
│   │   ├── breadth.test.js
│   │   ├── crowd.test.js
│   │   ├── screener.test.js
│   │   ├── kline.test.js
│   │   └── fetcher.test.js
│   └── scripts/               # 手动 / 联网调试脚本
│       ├── test-feishu.js     # 飞书凭证自检（npm run test:feishu）
│       ├── probe.js           # 接口契约探针（npm run probe）
│       ├── run_close_once.js  # 手动跑一次完整收盘流程
│       └── trial_ma20.js      # 本地快照试跑 MA20 精筛
├── web/
│   ├── index.html             # Web 面板：单文件 Vue 3 + ECharts
│   └── vendor/                # 本地 Vue / ECharts 静态资源
├── data/
│   ├── holidays.json          # 节假日数据
│   ├── history/               # 按年份分文件的历史数据（如 2026.json）
│   ├── history_backup/        # 历史数据自动备份
│   ├── price_history/         # 收盘价快照 + screener_result.json
│   ├── gold_history/          # 金价与黄金股日快照
│   ├── watchlist.json         # 关注列表
├── logs/
│   ├── index.log              # 运行日志（文件侧 INFO 及以上）
│   └── error.log              # 错误日志（ERROR 级别）
├── CLAUDE.md                  # Claude Code 项目指引
├── README.md
└── package.json
```

***

## 8. 技术选型

| 模块       | 选型                          | 说明                                       |
| -------- | --------------------------- | ---------------------------------------- |
| 运行环境     | Node.js 22+                 | LTS 版本，项目已切到 Node 22                      |
| HTTP 请求  | `axios`                      | 请求/重试/超时/拦截器开箱即用，飞书 SDK 内部亦依赖 axios      |
| 数据存储     | JSON 文件                      | 轻量，无需数据库                                 |
| 定时调度     | 进程内部定时器                      | 常驻服务自管调度，不依赖外部 cron                      |
| 飞书推送     | `@larksuiteoapi/node-sdk`    | 官方 SDK，App Bot 模式，token 自动管理，支持卡片/图片/附件   |
| 反爬代理（可选） | `https-proxy-agent`          | 需走代理时用；默认不启用                             |
| 前端图表   | ECharts（本地 vendor）        | Web 面板零 npm 依赖，直接引用本地 `web/vendor/echarts.min.js` |

**原则**：按需引入 npm 依赖，控制依赖数量与质量（优先官方/高维护度包），不为"零依赖"牺牲功能可维护性。核心依赖仅 `axios` + `@larksuiteoapi/node-sdk`，均为官方/主流包；其余能力（定时、JSON 存储、HMAC）仍用 Node 内置模块。

### 8.1 依赖清单（package.json）

```json
{
  "dependencies": {
    "axios": "^1.7.0",
    "@larksuiteoapi/node-sdk": "^1.71.0"
  },
  "optionalDependencies": {
    "https-proxy-agent": "^7.0.0"
  },
  "devDependencies": {
    "@playwright/mcp": "^0.0.79",
    "@playwright/test": "^1.62.1"
  }
}
```

- `axios`：数据拉取（东财/新浪行情、融资融券、ETF）+ 反爬重试/超时；
- `@larksuiteoapi/node-sdk`：飞书 App Bot 推送（卡片、图片、文件）；
- `https-proxy-agent`（可选）：仅当部署环境需走代理访问飞书/数据源时装，默认不装；
- `@playwright/test` / `@playwright/mcp`：浏览器自动化测试与 MCP 工具（开发依赖，运行时不需要）。

***

## 9. 配置项

### 9.1 config.json 示例

```json
{
  "indices": [
    { "name": "上证指数", "code": "000001", "exchange": "SH" },
    { "name": "创业板指", "code": "399006", "exchange": "SZ" }
  ],
  "thresholds": {
    "normal": 40,
    "warning": 50
  },
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "chatId": "oc_xxx",
    "domain": "feishu"
  },
  "mode": "both",
  "intradayPoints": ["10:00", "11:00", "14:00"],
  "closeTime": "19:00",
  "etfWhitelist": ["510300", "510050", "510500", "510310", "159915"],
  "etfSurgeRatio": 2.5,
  "marginUnit": "亿元",
  "historyDays": 30,
  "maxRetries": 3,
  "feishuMaxBytes": 20000,
  "nid18Enabled": false,
  "proxy": null,
  "historyStorage": {
    "enabled": true,
    "dir": "data/history",
    "backupDir": "data/history_backup",
    "autoCompact": true,
    "backupRetentionDays": 30
  },
  "web": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 8787
  },
  "screener": {
    "ma20Source": "auto",
    "ma20Days": 20,
    "concurrency": 4,
    "cacheTtlMs": 600000
  },
  "goldStocks": ["600547", "601899", "600489", "002155", "600988", "518880", "159934"],
  "dataSources": {
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 3,
      "cooldownMs": 300000
    }
  }
}
```

### 9.2 配置说明

| 字段                   | 说明                                                                            |
| -------------------- | ----------------------------------------------------------------------------- |
| `indices`            | 监控的指数列表，包含名称、代码、交易所                                                           |
| `thresholds.normal`  | 正常与关注区的分界值（40）                                                                |
| `thresholds.warning` | 关注区与预警区的分界值（50）                                                               |
| `dingtalk.webhook`   | （已弃用，改用飞书 App Bot，见 `feishu.*`）                                              |
| `feishu.appId`       | 飞书自建应用 App ID（开放平台后台 → 凭证与基础信息），App Bot 模式必需                                  |
| `feishu.appSecret`   | 飞书自建应用 App Secret，与 appId 配对，SDK 据此自动获取/刷新 `tenant_access_token`               |
| `feishu.chatId`      | 目标群 chat_id（将应用机器人加入目标群后获得），消息推送目标                                                |
| `feishu.domain`      | `feishu`（国内，默认）或 `lark`（国际版 Lark），对应 SDK `lark.Domain.Feishu` / `lark.Domain.Lark` |
| `mode`               | 推送模式：`intraday`（仅盘中）/ `close`（仅收盘）/ `both`（两者，默认）                             |
| `intradayPoints`     | 盘中快照时间点列表（HH:mm），默认 10:00、11:00、14:00                                         |
| `closeTime`          | 收盘汇总时间点（HH:mm），默认 19:00（融资融券当日数据约 18:00 才发布）                                 |
| `logDir`             | 日志目录，默认 `logs`（相对项目根目录），可配绝对路径如 `/data/log`                                   |
| `logConsoleLevel`    | 控制台日志级别：`DEBUG`/`INFO`/`WARN`/`ERROR`（默认 `ERROR`，控制台只显示错误）                     |
| `etfWhitelist`       | 国家队代理监控的宽基 ETF 代码列表，默认 510300/510050/510500/510310/159915                     |
| `etfSurgeRatio`      | 疑似国家队成交额放大倍数阈值（当日/前一日成交额，默认 2.5 倍）                                            |
| `marginUnit`         | 融资融券金额展示单位，默认“亿元”                                                             |
| `historyDays`        | 保留并展示的历史交易日数量                                                                 |
| `maxRetries`         | 数据拉取失败时的最大重试次数                                                                |
| `feishuMaxBytes`     | 飞书单条卡片大小上限，超过则拆分发送                                                          |
| `nid18Enabled`       | 是否启用东方财富 nid18 反爬设备指纹（默认 false）                                              |
| `proxy`              | HTTP/HTTPS 代理地址，为空则不使用代理                                                         |
| `historyStorage.enabled` | 是否启用本地历史数据存储（默认 true）                                                      |
| `historyStorage.dir`     | 历史数据存储目录（默认 `data/history`，按年分文件）                                         |
| `historyStorage.backupDir` | 历史数据自动备份目录（默认 `data/history_backup`）                                        |
| `historyStorage.autoCompact` | 是否每周五收盘后自动整理历史数据（去重/校验/裁剪/清理空年份文件，默认 true）                |
| `historyStorage.backupRetentionDays` | 备份文件保留天数（默认 30 天，每周五 compact 时清理过期备份）                              |
| `web.enabled`        | 是否启用 Web 面板（默认 true）                                                          |
| `web.host`           | Web 面板监听地址（默认 `127.0.0.1`）                                                    |
| `web.port`           | Web 面板监听端口（默认 8787）                                                           |
| `screener.ma20Source` | MA20 精筛数据源：`auto`（腾讯→新浪）/ `tencent` / `sina` / `off`（关闭精筛）               |
| `screener.ma20Days`  | MA20 计算天数（默认 20）                                                                |
| `screener.concurrency` | 精筛并发请求数（默认 4）                                                                |
| `screener.cacheTtlMs` | 日 K 缓存有效期（默认 600000 ms）                                                       |
| `screener.bjCutoff`  | MA20 精筛时是否启用北交所熔断（默认 true）：窗口内失败频率过高则跳过北交所日K，避免卡住 |
| `screener.bjFailureThreshold` | 北交所日K失败多少次即触发跳过（默认 3）                                          |
| `screener.bjWindowSize` | 北交所日K失败统计窗口大小（默认 10）                                                 |
| `goldStocks`         | 黄金走势页面跟踪的黄金股 / ETF 代码列表                                                     |
| `dataSources.circuitBreaker.enabled` | 是否启用数据源域名级熔断（默认 true）                                            |
| `dataSources.circuitBreaker.failureThreshold` | 连续失败多少次触发熔断（默认 3）                                         |
| `dataSources.circuitBreaker.cooldownMs` | 熔断后冷却时间（默认 300000 ms）                                         |

***

## 10. 推送消息示例

### 10.1 盘中快照消息

以飞书消息卡片推送，卡片头部为标题，正文用 `lark_md` 文本块 + `column_set` 多列布局呈现。下方为**渲染后效果示意**（实际发送为卡片 JSON，见 11.4）：

```text
【A股大盘拥挤度监控·盘中】2026-07-18 11:00

上证指数：42.30%  ⚠️ 关注区  (较 10:00 ↑0.45)
创业板指：38.10%  ✅ 正常    (较 10:00 ↓0.20)

市场广度：
  涨/跌/平：3200 / 1500 / 120
  涨停/跌停：28 / 5
  两市成交：8650 亿（中等活跃）

提示：上证指数进入关注区，头部交易集中度上升，留意后续风格切换风险。
```

> 拥挤度两行可用 `column_set` 排成两列对照；市场广度三项同样可用多列布局对齐。

### 10.2 收盘汇总消息

以飞书消息卡片推送，融资明细、ETF 异动、近 30 日对比均用 `column_set` 多列布局画成**真表格**（飞书卡片支持）。下方为**渲染后效果示意**：

```text
【A股大盘拥挤度监控】2026-07-18

上证指数：42.30%  ⚠️ 关注区
创业板指：38.10%  ✅ 正常

市场广度：
  涨/跌/平：3200 / 1500 / 120
  涨停/跌停：28 / 5
  两市成交：12800 亿（高活跃）

融资融券余额（亿元）：
┌──────────┬──────────┬───────────┐
│ 融资余额 │ 融券余额 │   合计    │
├──────────┼──────────┼───────────┤
│ 15230.45 │  856.30  │ 16086.75  │
│ +85.20   │ -12.50   │ +72.70    │
└──────────┴──────────┴───────────┘

宽基ETF成交额异动（当日成交额 / 前一日成交额）：
┌──────────────┬────────┬──────┬──────────┐
│ ETF          │ 当日额 │ 倍数 │ 标记     │
├──────────────┼────────┼──────┼──────────┤
│ 510300 沪深300│ 185.20 │ 3.2x │ 疑似国家队│
│ 510050 上证50 │  42.10 │ 1.1x │ -        │
│ 510500 中证500│  28.50 │ 0.9x │ -        │
│ 159915 创业板 │  15.30 │ 1.0x │ -        │
└──────────────┴────────┴──────┴──────────┘

近30日拥挤度对比：
┌────────┬──────────┬──────────┐
│ 日期   │ 上证     │ 创业     │
├────────┼──────────┼──────────┤
│ 07-18  │ 42.30%   │ 38.10%   │
│ 07-17  │ 41.85%   │ 39.20%   │
│ ...    │ ...      │ ...      │
└────────┴──────────┴──────────┘

解读：上证指数进入关注区，头部交易集中度上升；融资余额连续净流入，杠杆情绪偏暖；沪深300ETF成交额较前一日放大 3.2 倍，疑似国家队入场，建议留意后续风格切换风险。
```

> 上方 ASCII 表格仅为示意，实际在飞书中以 `column_set` + `column` 元素渲染为带边框的对齐表格。

***

## 11. 关键实现要点

### 11.1 数据拉取

数据抓取已重构为**策略模式**，统一由 `lib/data/manager.js` 的 `FetcherManager` 按 capability 路由，支持优先级排序、自动 failover、熔断和校验：

- **BaseFetcher 契约**（`lib/data/base.js`）：每个 fetcher 声明 `name`、`priority`、`capability`（如 `allA`、`indexQuote`、`etfQuote`、`margin`、`kline`、`goldPrice`）、`marketSupport` 和 `fetch` 方法。
- **FetcherManager**：执行时按 capability 过滤可用 fetcher，按优先级排序，依次尝试；单源失败或校验不通过时自动降级下一源；所有源失败则返回错误，由上层推"数据异常"告警卡。
- **CircuitBreaker**（`lib/data/breakers.js`）：域名级熔断。连续失败 `failureThreshold` 次或遇到 501（腾讯 WAF）/ 456（新浪封禁）时立即熔断，冷却 `cooldownMs`（默认 5 分钟）后再恢复。

注册在 `service.js` 的 fetcher 优先级：

| 能力 | 主源 | 兜底 |
| --- | --- | --- |
| `allA` | 新浪 `Market_Center.getHQNodeData` 分页（约 70 页 / 5500+ 只） | 东财 `clist/get` 大包 |
| `indexQuote` | 新浪 `hq.sinajs.cn` | 东财 `stock/get` |
| `etfQuote` | 新浪 `hq.sinajs.cn` | 东财 `stock/get` |
| `margin` | 东财 `datacenter-web.eastmoney.com` | 上交所 + 深交所官方接口 |
| `kline` | 腾讯日 K | 新浪日 K |
| `goldPrice` | 新浪 `hf_XAU` | — |

统一抓取逻辑：

- **全 A 抓取**：串行翻页，逐页回调 `onProgress` 打印进度；校验要求返回 ≥3000 只；新浪失败或数据异常时降级东财大包。
- **成分股派生**：上证 = 全 A 中 `market === 0` 且代码 `60/688` 开头；创业板 = 代码 `30` 开头。与全 A 同源，保证拥挤度分子分母口径一致（见 §2.3）。
- **B 股**：新浪 `sh_b`/`sz_b` 节点，成交额计入两市总成交额，失败不阻断主流程。
- **盘中拉取的是当日累计成交额**（从开盘到当前时刻），收盘后为全天成交额，计算口径一致。

**反爬实现**（封装于 `lib/core/http.js`，基于 `axios`，详见 §4.5）：

- 每次请求构造随机 `User-Agent`（从内置 UA 池取，含 Chrome/Edge/Firefox 常见 UA）；
- 带常规浏览器请求头（`Accept`/`Accept-Language`/`Connection: keep-alive`）；
- 新浪请求自动带随机 `Referer` / `Cookie`；分页间 `sleep` 随机间隔（全 A 1.2–2.5s）；
- 分页全为串行，避免并发翻页绕过限速；
- 需 Referer 的接口（上交所/深交所融资融券）按源配置 `Referer` 头。

**重试与故障转移**：

- 单次请求失败（网络异常 / 非 200 / 返回空数据）按指数退避重试 `maxRetries` 次，退避时长 `1s/3s/8s` + 随机抖动（±300ms）；
- **456（新浪 IP 级封禁）立即失败并降级**，不重试（避免加剧封禁）；403/503 走更长冷却重试；
- 所有源均失败时，推送“数据异常”告警卡（`buildErrorCard`）并记录错误日志，当日该指标标记为缺失，不推送全 0 假数据。

### 11.2 拥挤度计算

1. 拉取全 A 股当日成交额（单位：元），过滤成交额为 0 / 停牌的股票；
2. 全 A 按成交额降序，取前 5%：`topCount = Math.max(1, Math.ceil(totalCount * 0.05))`；
3. **分子** = 全 A 前 5% 中属于该市场的股票成交额之和（上证 `market === 0`，创业板代码 `30` 开头）；
4. **分母** = 该市场全部有效成分股（同源派生）成交额之和；
5. 拥挤度 = 分子 / 分母 × 100%，保留两位小数（`Math.round(numerator / denominator * 10000) / 100`）。

#### 11.2.1 市场广度计算

1. 从东方财富行情接口获取沪深两市全市场个股当日涨跌幅（盘中为实时累计，收盘为全天）；
2. 统计涨家数（涨幅 > 0）、跌家数（跌幅 < 0）、平家数（涨幅 = 0）；
3. 统计涨停家数（涨幅触及涨停板，含一字板与盘中封板）、跌停家数（同理）；
4. 两市总成交额 = 沪市成交额 + 深市成交额（行情接口标准字段，单位元，展示换算为亿元）；
5. 按总成交额判定活跃度分级：≥15000 亿高活跃 / ≥9000 亿中等 / <9000 亿缩量观望；
6. 盘中快照与收盘汇总均推送上述四项统计 + 活跃度分级。

> 涨跌家数与涨跌停家数可复用拥挤度计算时已拉取的成分股行情数据（同一批个股涨跌幅），避免重复请求；两市总成交额为行情接口的汇总字段，单次请求即可获得。

#### 11.2.2 技术筛选

技术筛选用于收盘汇总和 Web 面板「筛选」页，采用**两级过滤**策略：

1. **本地粗筛**（`lib/algo/screener.js`）：基于近 10 日收盘价快照，筛选出「连续 3 日上涨 且 现价 ≥ MA5 > MA10」的个股。需要至少积累满 10 个交易日才具备计算条件。
2. **MA20 二次精筛**：对粗筛结果并发拉取日 K 数据（默认腾讯主源、新浪兜底，可配置 `screener.ma20Source`），计算 MA20，仅保留「现价 ≥ MA20 且 MA5 > MA10 > MA20」的个股。无法取得 MA20 的股票计入 `ma20Missing`，不强行按 0 处理。
3. **北交所熔断**：部分免费数据源对北交所（4/8/92 开头）支持不稳定，为避免精筛长时间卡住，当最近 `screener.bjWindowSize` 次北交所请求中失败达到 `screener.bjFailureThreshold` 次时，后续北交所股票直接跳过，计入 `ma20Missing`。可通过 `screener.bjCutoff` 关闭。

精筛结果落盘到 `data/price_history/screener_result.json`，Web 面板 `/api/screener` 优先直读该文件，避免每次访问都重算日 K；当缓存与请求的 `upDays` 不符或无缓存时，才回退到实时计算。

### 11.3 历史数据

- **收盘记录落盘**：每天 19:00 收盘汇总成功后将结果写入 `data/history/YYYY.json`；同一 `date` 重复运行会覆盖当天数据，避免重复记录；推送收盘汇总时取最近 `historyDays` 条 `close` 记录。
- **盘中快照落盘**：盘中快照也写入 `data/intraday.json`，用于 Web 面板「当日盘中轨迹」回看；变化值（↑/↓）优先取自进程内存中当日上一快照，内存丢失时从盘中落盘读取。
- **收盘价快照**：收盘后把全 A 收盘价按日写入 `data/price_history/YYYY-MM-DD.json`，保留约 370 天，作为技术筛选数据源。
- **技术筛选结果落盘**：精筛结果写入 `data/price_history/screener_result.json`，Web 面板 `/api/screener` 优先直读，避免每次访问重算日 K。
- **黄金数据落盘**：金价 + 黄金股/ETF 收盘价按日写入 `data/gold_history/YYYY-MM-DD.json`。
- **关注列表**：服务端 `data/watchlist.json` 存储，Web 面板读写，跨设备同步。
- **可靠性**：进程内缓存减少重复磁盘读取；写入前进行数据校验，无效记录拒绝落盘；使用简单写锁避免并发写冲突；每次写入前先备份旧文件，再写 `.tmp` 最后 `rename`，保证原子性。
- **自动整理**：每周五收盘后自动执行 `compactHistory`，对全量记录去重、校验、裁剪 `historyDays`、清理空年份文件，保持存储整洁。

### 11.4 飞书推送

封装于 `lib/feishu.js`，基于官方 SDK `@larksuiteoapi/node-sdk`（App Bot 模式）。

**客户端初始化**（SDK 自动管理 `tenant_access_token` 获取与刷新，无需手写加签）：

```javascript
const lark = require('@larksuiteoapi/node-sdk');
const client = new lark.Client({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  domain: lark.Domain.Feishu,   // 国际版用 lark.Domain.Lark
});
```

**发送消息卡片**（`msg_type: "interactive"`，卡片 JSON 作为 `content` 字符串传入）：

```javascript
await client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: config.feishu.chatId,
    msg_type: 'interactive',
    content: JSON.stringify(cardJson),   // cardJson 见下方结构
  },
});
```

- 卡片发送失败时回退 `msg_type: 'text'`，`content: JSON.stringify({text: '...'})`；
- SDK 内部用 axios 发请求，超时/重试可经 `httpInstance` 或外层包裹。

**卡片 JSON 结构**：

```json
{
  "config": { "wide_screen_mode": true },
  "header": { "title": { "tag": "plain_text", "content": "A股大盘拥挤度监控·盘中" } },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "上证指数：42.30% ⚠️ 关注区" } },
    { "tag": "column_set", "columns": [ ... ] },
    { "tag": "hr" },
    { "tag": "img", "img_key": "img_v3_xxx", "alt": { "tag": "plain_text", "content": "30日拥挤度走势" } }
  ]
}
```

- 也可用 SDK 内置助手 `lark.messageCard.defaultCard({title, content})` 快速生成基础卡片，富表格仍手写 JSON。

**多列布局（表格实现，关键）**：

飞书卡片 `lark_md` 文本块**不支持 Markdown 表格**（`|...|` 不渲染）。真表格用 `column_set` + `column` 元素实现：

```json
{
  "tag": "column_set",
  "columns": [
    { "tag": "column", "width": "weighted", "weight": 1, "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "**融资余额**\n15230.45\n+85.20" } }
    ]},
    { "tag": "column", "width": "weighted", "weight": 1, "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "**融券余额**\n856.30\n-12.50" } }
    ]},
    { "tag": "column", "width": "weighted", "weight": 1, "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "**合计**\n16086.75\n+72.70" } }
    ]}
  ]
}
```

- 每列为一个字段，列内多行用 `\n` 分隔（表头/数值/变动），形成对齐的“表格”视觉效果；
- 多行表格（如近 30 日对比、ETF 列表）可用多个 `column_set` 纵向堆叠，或每行一个 `column_set`；
- `column` 支持 `weight` 控制列宽，`width: "weighted"` 按权重分配。

**lark_md 渲染能力边界**：

- 支持：加粗 `**`、链接、有序/无序列表、引用；
- **不支持**：Markdown 标题（`#`/`##`，用加粗代替）、表格（用 `column_set` 代替）、删除线；
- 分割线用 `{"tag":"hr"}` 元素，不用 `---`。

**图片上传与内嵌（App Bot 能力，关键）**：

App Bot 模式支持上传本地图片得 `image_key`，再以 `img` 元素内嵌卡片，**可发 30 日拥挤度走势图**：

```javascript
// 1. 上传本地 PNG 得 image_key
const uploadRes = await client.im.image.create({
  data: { image_type: 'message', image: fs.createReadStream('trend.png') },
});
const imageKey = uploadRes.data.image_key;

// 2. 卡片 elements 中加 img 元素
{ "tag": "img", "img_key": imageKey, "alt": { "tag": "plain_text", "content": "30日拥挤度走势" } }
```

- 也可用 `client.im.file.create` 上传文件得 `file_key`，以 `msg_type: 'file'` 单独发文件（如 PDF 报告）；
- 走势图生成：Web 面板已用 ECharts 绘制，如需推送到飞书，可先用 canvas 库（如 `node-canvas`）生成 PNG 后上传，或调用外部图表服务生成。

**响应处理**：

- SDK 返回对象含 `code`/`msg`/`data`，成功 `code === 0`；
- 失败按 `code` + `msg` 记录到 `logs/error.log`；
- 常见错误：`99991663`（token 失效，SDK 一般自动刷新）、`230002`（无权限发消息到该群，检查应用机器人是否入群）、`9499`（频率限制，待核实）。

**频率限制**：

- 飞书 App Bot 消息接口约 5 条/秒/应用、单条消息大小上限约 30KB（待核实）；
- 本项目盘中 3 条 + 收盘 1 条 = 4 条/天，远低于频率限制；但单条收盘汇总含多表格，需注意字节数，超限时按 `feishu_max_bytes`（默认 20000）分页发送；
- 推送失败重试采用**指数退避**（5s/15s/30s），避免短时连发触发频率限制。

**模板**：盘中快照与收盘汇总分别使用对应模板（见第 10 节），均在 `lib/feishu.js` 内组装卡片 JSON 并经 SDK 发送。

### 11.5 常驻服务与调度

- 脚本以常驻进程运行（入口 `service.js`），内部用定时器自管调度，不依赖外部 cron；
- 盘中快照点（`intradayPoints`）与收盘汇总（`closeTime`，默认 19:00）均由进程内部定时器触发；
- 进程内 `process.on('uncaughtException')` / `unhandledRejection` 兜底，避免单次异常导致进程退出；
- 非交易日、午休时段由进程内部判断后跳过本次调度。

### 11.6 融资融券拉取

- 主源：东方财富 `datacenter-web.eastmoney.com/api/data/v1/get`，`reportName=RPTA_WEB_MARGIN_DAILYTRADE`，取最新一条的 `FIN_BALANCE`（融资余额，亿元）/ `LOAN_BALANCE`（融券余额，亿元）；
- **T 日 19:00 后拉取当日数据**：交易所约 18:00 发布、东财 18:00–19:00 转发，15:05 前拉取为 T-1 数据；
- 备选校验：上交所 `query.sse.com.cn`（沪市，单位**元**，需 Referer）+ 深交所 `szse.cn/api/report/ShowReport/data`（深市，单位**亿元**，需 Referer），合计前统一换算为亿元；
- **深交所字段尚未核实**：解析不到时该侧标记缺失（返回 `partial: true`）并在日志告警，不将深市按 0 计入合计，避免合计被低估（2026-08-08 修复，此前占位实现会把深市当 0）；
- 单位统一为 `marginUnit`（默认亿元）；
- 拉取失败重试 `maxRetries` 次，均失败则推送“数据异常”告警。

### 11.7 宽基 ETF 成交额异动

- 拉取 `etfWhitelist` 中每只宽基 ETF 的当日成交额与前一日成交额（**新浪优先** `hq.sinajs.cn` 单请求，东财 `push2 stock/get` 兜底，`maxRetries: 1`）；
- 计算放大倍数 = 当日成交额 / 前一日成交额；
- 放大倍数 ≥ `etfSurgeRatio`（默认 2.5 倍）者，打“疑似国家队”标签；
- 汇金官网公告时间点做事件标注（公告仅定性，无金额，需人工或抓取）；
- 拉取失败重试 `maxRetries` 次，均失败则该 ETF 标记为数据缺失，不阻断整体推送。

### 11.8 Web 面板

Web 面板是一个零 npm 依赖的单文件应用（`web/index.html`：Vue 3 global build + ECharts），由 `lib/view/web.js` 通过 `node:http` 伺服，默认监听 `127.0.0.1:8787`。五个 tab：

- **概览**：指标卡 + 上证/创业板拥挤度历史曲线（30/60/120 日）+ 当日盘中轨迹。
- **筛选**：技术筛选命中列表，支持板块 / 价格区间 / 已关注三维前端筛选；列表采用虚拟滚动，只渲染可视区行；关注列表存服务端 `data/watchlist.json`，跨设备同步。
- **个股**：输入 6 位代码查询收盘价 + MA5/MA10 走势图。
- **黄金**：伦敦金现货（美元/盎司）叠加黄金股/ETF 收盘价的双 Y 轴走势图（30/60/120 日）。
- **配置**：在线编辑 `config.json`（`appSecret` 脱敏显示为 `***`），保存后提示需重启服务生效；支持手动触发完整收盘流程（二次确认、防重入、非交易日拒绝）。

后端 API：

- `GET /api/indices/history?days=60`：指数拥挤度历史。
- `GET /api/intraday?date=today`：当日盘中快照轨迹。
- `GET /api/stock/{code}?days=60`：个股收盘价 + MA5/MA10。
- `GET /api/screener?upDays=3`：技术筛选结果，优先读落盘缓存。
- `GET /api/gold/history?days=60`：黄金走势数据。
- `GET|POST /api/watchlist`：关注列表读写。
- `GET|POST /api/config`：配置读写（GET 脱敏 appSecret）。
- `POST /api/run-close`：手动触发收盘汇总，异步执行，立即返回 202。

### 11.9 黄金走势

收盘附加步骤会抓取伦敦金现货（新浪 `hf_XAU`），并解析 `config.goldStocks` 中的黄金股与 ETF：A 股代码从当日全 A 收盘价快照中读取，ETF 代码通过 ETF 行情接口单独补抓，最终写入 `data/gold_history/YYYY-MM-DD.json`。Web 面板「黄金」tab 读取这些数据，绘制金价与黄金股/ETF 收盘价的双 Y 轴叠加走势图，支持 30/60/120 日回看。

***

## 12. 部署方式

脚本以 **Node 本地常驻服务** 形式运行：进程内部用定时器自管调度（盘中各快照点 + 19:00 收盘汇总），外部仅负责“开机自启 + 崩溃自动拉起”。不再使用 crontab / GitHub Actions / Docker 等外部 cron 方案。

### 12.1 前置条件

- 已安装 Node.js（建议 18+ LTS），并能在 PowerShell 中执行 `node -v`；
- 脚本目录已准备就绪（按实际部署路径，如 `d:\front\test\stock-script`）；
- 已执行 `npm install` 安装依赖（`axios`、`@larksuiteoapi/node-sdk`，见 §8.1）；
- 已在飞书开放平台创建自建应用，获得 `appId` / `appSecret`，并将应用机器人加入目标群获得 `chatId`（应用需开通“机器人”能力与 `im:message` 发消息权限）；
- 已创建 `config.json` 并填写 `feishu.appId` / `feishu.appSecret` / `feishu.chatId`、`mode`、`intradayPoints` 等配置。

### 12.2 常驻服务启动方式

直接前台运行（调试用）：

```bash
node service.js
```

后台常驻运行需配合下文开机自启方案，并将 stdout/stderr 重定向到 `logs/index.log`（或 `logDir` 指定路径）。

### 12.3 开机自启方案（二选一）

#### 方案 A：任务计划程序（仅启动一次）

任务计划程序**只负责开机/登录时启动一次** **`service.js`**，不再为每个时间点建触发器（调度由进程内部定时器完成）。

1. `Win + R` 输入 `taskschd.msc` 打开任务计划程序；
2. “任务计划程序库” → 右侧“创建任务”；
3. **常规**：名称 `A股大盘拥挤度监控`；安全选项选“不管用户是否登录都要运行”；
4. **触发器** → 新建：开始任务选“启动时”或“登录时”，勾选“已启用”；
5. **操作** → 新建：操作“启动程序”，程序 `node.exe`，参数 `service.js`，起始于脚本目录；
6. **设置**：勾选“允许按需运行任务”；“如果此任务已经运行，以下规则适用”选“请勿启动新实例”。

- 优点：无需额外软件（任务计划程序系统自带），零运维成本；
- 缺点：任务计划程序本身不自动拉起崩溃的进程，需依赖进程内 `uncaughtException` 兜底；若进程仍退出，需手动或借助方案 B 的拉起机制。

#### 方案 B：nssm 注册为系统服务（推荐长期挂机）

用 [nssm](https://nssm.cc/)（轻量单文件，无需安装）将 Node 脚本注册为 Windows 系统服务，开机自启 + 崩溃自动拉起。

```powershell
nssm install AStockCrowdMonitor "C:\Program Files\nodejs\node.exe" "service.js"
nssm set AStockCrowdMonitor AppDirectory "d:\front\test\stock-script"
nssm set AStockCrowdMonitor AppStdout "d:\front\test\stock-script\logs\index.log"
nssm set AStockCrowdMonitor AppStderr "d:\front\test\stock-script\logs\index.log"
nssm set AStockCrowdMonitor AppRotateFiles 1
nssm set AStockCrowdMonitor AppRotateBytes 10485760
nssm start AStockCrowdMonitor
```

- 优点：开机自启 + 崩溃自动拉起最可靠，自带日志轮转；
- 缺点：需下载 nssm（单文件，放至 PATH 即可）。

> Linux 服务器对应使用 systemd unit（`Type=simple`、`Restart=always`），思路同方案 B。

### 12.4 验证服务

1. 启动后观察 `logs/index.log`（或 `logDir` 指定目录），确认进程常驻、无立即退出；
2. 手动触发一次计算（可临时把某快照点改为当前时间，或运行单次计算入口）确认消息已推送到飞书；
3. 等待下一个快照点，确认盘中快照自动触发并推送；
4. 进程异常时确认外层（nssm / 任务计划）或进程内兜底已生效。

### 12.5 常见问题

| 问题      | 可能原因                       | 解决方法                                                     |
| ------- | -------------------------- | -------------------------------------------------------- |
| 服务不运行   | `node.exe` 不在系统 PATH       | 使用 `node.exe` 的绝对路径，如 `C:\Program Files\nodejs\node.exe` |
| 脚本找不到文件 | 工作目录未设置                    | 设置 AppDirectory / “起始于”为脚本所在目录                           |
| 飞书没收到消息 | App Bot 凭证错误 / 应用未入群 / 权限不足 / 网络问题 | 检查 `feishu.appId`/`appSecret`/`chatId`、应用机器人是否已加入目标群、`im:message` 权限是否开通、网络连接 |
| 节假日推送   | 非交易日也会触发调度                 | 脚本内部判断交易日，非交易日直接跳过本次调度                                   |
| 进程频繁崩溃  | 未捕获异常 / 内存泄漏               | 进程内 `uncaughtException` 兜底 + 外层自动拉起 + 日志轮转               |

***

## 13. 风险与后续扩展

### 13.1 当前风险

| 风险            | 说明                                            | 缓解措施                                                       |
| ------------- | --------------------------------------------- | ---------------------------------------------------------- |
| 免费数据源失效       | 东方财富接口可能调整或限流                                 | 预留备选数据源接口                                                  |
| 盘中接口限流/延迟     | 盘中高频拉取易触发限流或返回延迟数据                            | 控制拉取频率、重试 `maxRetries` 次、异常时记录日志                           |
| 盘中成交额口径       | 盘中为当日累计成交额，与收盘全天口径一致但数值会随时间增长                 | 消息标注时间点，对比仅在同口径（同为盘中累计或同为收盘）下进行                            |
| 推送频率扰民        | 盘中每小时推送可能偏吵                                   | 盘中消息精简；可经 `mode` 关闭盘中推送（设为 `close`）                        |
| 节假日推送         | 非交易日也会触发调度                                    | 脚本内部判断交易日，非交易日直接跳过本次调度                                     |
| 常驻进程崩溃/内存泄漏   | 长期运行可能因未捕获异常或泄漏退出                             | 进程内 `uncaughtException` 兜底 + 外层 nssm/systemd 自动拉起 + 日志轮转   |
| 本地数据丢失        | 历史数据保存在 `data/history/YYYY.json`，每次写入前会自动备份到 `data/history_backup` | 定期备份整个 `data` 目录；`historyStorage.autoCompact` 每周五自动整理并去重 |
| 国家队 ETF 非精确金额 | 代理指标（成交额放大），非国家队主体真实操作                        | 文档如实说明 + 标签为“疑似”，不承诺精确金额                                   |
| 融资融券/ETF 单位差异 | 上交所为元、深交所为亿元、ETF 成交额为元                        | 拉取后统一换算为亿元展示，配置 `marginUnit` 控制                            |
| 东财接口字段变更      | 接口 URL/字段可能不定期调整                              | 成交额为标准字段较稳定；融资融券备选交易所官方源兜底                                 |
| 反爬升级 / IP 被封  | 东财等源加强风控，固定 UA 或高频请求被限流（403/空数据）               | 随机 UA + 请求间隔 + 指数退避 + 多源故障转移（见 §4.5）；限流时降级备选源，不硬刚            |
| 飞书 SDK / 接口变更   | 官方 SDK 版本升级或 OpenAPI 调整                     | 锁定 SDK 主版本（`^1.71`）；`lib/feishu.js` 留 `sendTest()` 实测兜底          |
| App Bot 权限/入群     | 应用未开通 `im:message` 权限或机器人未加入目标群，推送被拒（code 230002） | 后台开通权限、将机器人加入目标群；`lib/feishu.js` 启动时发测试消息校验            |
| 依赖包失效/弃用        | `axios` 或飞书 SDK 停止维护或 breaking change         | 选官方/高维护度包；锁定主版本；定期检查更新                                       |
| 飞书频率/大小限制     | 短时连发或单条超 30KB 可能触发限流                          | 本项目 4 条/天无忧；超限按 `feishu_max_bytes` 分页；失败重试指数退避（5s/15s/30s） |
| 卡片表格渲染异常      | `column_set` 结构错误或字段超长导致表格错位                  | `lib/feishu.js` 组装后校验 JSON 结构；超长内容分页或截断                    |

### 13.2 后续扩展

- 增加沪深 300、中证 500、科创 50 等宽基指数；
- 增加阈值触发推送（如拥挤度突破 50% 时单独告警）；
- 接入数据库或对象存储，持久化历史数据；
- 收盘汇总内嵌 30 日拥挤度走势图（App Bot 已支持图片上传，可先生成 PNG 再嵌入卡片）；
- 支持企业微信、钉钉等其他推送渠道（多渠道并行）；
- 技术筛选增加更多均线/量价因子；
- 节假日表改为自动更新或接入交易所日历接口。

***

## 14. 确认清单

- [x] 拥挤度定义与阈值已确认
- [x] 市场广度指标（涨跌家数/涨跌停/总成交额 + 活跃度分级）已确认
- [x] 监控指数（上证指数、创业板指）已确认
- [x] 盘中计算频率（每小时 1 次，默认 10:00 / 11:00 / 14:00）已确认
- [x] 盘中推送策略（每次计算都推，含拥挤度 + 市场广度）已确认
- [x] 推送内容包含近 30 日对比已确认
- [x] 数据源优先使用新浪财经（东财兜底）已确认
- [x] 部署方式（Node 本地常驻服务，开机自启 + 崩溃重启）已确认
- [x] 融资融券余额总额跟踪已确认
- [x] 国家队 ETF 代理指标方案（成交额异动 + 异常放大标签 + 公告标注）已确认
- [x] 两新指标仅在收盘汇总推送已确认
- [x] 收盘汇总时间调整为 19:00（融资融券当日数据约 18:00 才发布）已确认
- [x] 飞书推送实现方案（官方 SDK + App Bot + 消息卡片 + column\_set 多列布局表格 + 图片上传）已确认
- [x] 反爬策略（随机 UA + 请求间隔 + 指数退避 + 多源故障转移 + 456 快速失败，基于 axios）已确认
- [x] 数据源策略模式（FetcherManager + BaseFetcher + CircuitBreaker）已确认
- [x] 技术筛选两级过滤（本地 MA5/MA10 粗筛 + 日 K MA20 精筛）已确认
- [x] Web 面板（Vue 3 + ECharts，概览/筛选/个股/黄金/配置五 tab）已确认
- [x] 黄金走势（伦敦金现货 + 黄金股/ETF 双 Y 轴叠加）已确认
- [x] 关注列表服务端存储与跨设备同步已确认
- [x] Web 配置在线编辑与手动触发收盘汇总已确认

*文档版本：v1.11*\
*编写日期：2026-07-18*\
*修订日期：2026-08-30（v1.11 同步代码现状：更新目录结构、配置项、数据源策略模式、Web 面板、技术筛选 MA20 精筛、黄金走势；同步修正黄金 ETF 行情获取方式；v1.10 数据抓取重构详见 CHANGELOG）*
