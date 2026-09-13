// 数据源策略管理器：按优先级依次尝试，自动 failover + 熔断检测。
// 参考 DSA(DataFetcherManager) 设计，轻量化 Node.js 实现。
class FetcherManager {
  /**
   * @param {Object} opts
   * @param {BaseFetcher[]} opts.fetchers  初始数据源列表
   * @param {CircuitBreaker} opts.circuitBreaker  熔断器实例
   * @param {Object} opts.logger  日志对象
   */
  constructor({ fetchers = [], circuitBreaker, logger } = {}) {
    this._fetchers = [...fetchers].sort((a, b) => a.priority - b.priority);
    this._cb = circuitBreaker;
    this._logger = logger;
  }

  /** 注册数据源，自动按优先级排序 */
  addFetcher(fetcher) {
    this._fetchers.push(fetcher);
    this._fetchers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 核心方法：按优先级依次尝试，首个成功即返回。
   * @param {Object} http        createHttpClient() 返回的 { get, instance }
   * @param {Object} params      调用方传入的上下文参数
   * @param {Object} opts
   * @param {string} opts.capability  数据类别标识，如 'allA' / 'indexQuote' / 'margin' / 'kline'
   * @param {Function} opts.validate  (result, sourceName) => boolean，可选校验
   * @param {string} opts.onlyName  可选，只试该名字的 fetcher（单源模式用）
   * @returns {Promise<{result: any, source: string, error?: string}>}
   */
  async execute(http, params, { capability = 'unknown', validate, onlyName } = {}) {
    const errors = [];

    // 过滤：capability 匹配 + 名字匹配（onlyName）+ 可用 + 非熔断 + 市场匹配
    const candidates = this._fetchers.filter((f) => {
      if (f.capability !== capability) return false;
      if (onlyName && f.name !== onlyName) return false;
      if (!f.isAvailable()) return false;
      const key = `${capability}:${f.name}`;
      if (this._cb && !this._cb.isAvailable(key)) {
        this._logger && this._logger.warn(`[数据源] ${capability} → ${f.name} 熔断中，跳过`);
        return false;
      }
      if (f.marketSupport && params.market && !f.marketSupport.has(params.market)) return false;
      return true;
    });

    if (candidates.length === 0) {
      return { result: null, source: 'none', error: '暂无可用数据源' };
    }

    for (const fetcher of candidates) {
      const key = `${capability}:${fetcher.name}`;
      try {
        this._logger && this._logger.info(`[数据源] ${capability} → ${fetcher.name} 尝试中...`);
        const result = await fetcher.fetch(http, params);

        // 可选校验
        if (validate && !validate(result, fetcher.name)) {
          throw new Error(`数据校验不通过 [${fetcher.name}]`);
        }

        if (this._cb) this._cb.recordSuccess(key);
        this._logger && this._logger.info(`[数据源] ${capability} → ${fetcher.name} 成功`);
        return { result, source: fetcher.name };
      } catch (e) {
        if (this._cb) this._cb.recordFailure(key, e);
        errors.push(`${fetcher.name}: ${e.message}`);
        this._logger && this._logger.warn(`[数据源] ${capability} → ${fetcher.name} 失败: ${e.message}`);
      }
    }

    return { result: null, source: 'none', error: errors.join('; ') };
  }
}

module.exports = { FetcherManager };