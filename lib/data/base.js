// 数据源抽象基类：定义统一契约，所有数据源 fetcher 继承此类。
// 参考 DSA(BaseFetcher) 设计，简化为 Node.js 函数式风格。
class BaseFetcher {
  name = 'base';              // 标识，用于日志和熔断 key
  priority = 99;               // 数字越小越优先
  capability = 'unknown';      // 数据类别，manager 据此路由（allA/indexQuote/etfQuote/margin/kline）
  marketSupport = null;        // null=支持所有市场，或 Set(['cn','hk','us'])

  // 子类必须实现：执行一次抓取，成功返回数据，失败抛出异常
  // http: createHttpClient() 返回的 { get, instance }
  // params: 调用方传入的上下文参数，由各 fetcher 自行解析
  async fetch(http, params) {
    throw new Error(`子类 ${this.constructor.name} 必须实现 fetch()`);
  }

  // 子类可选实现：检查数据源是否可用（如 token 未配置 → false）
  isAvailable() {
    return true;
  }
}

module.exports = { BaseFetcher };