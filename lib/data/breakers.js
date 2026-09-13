// 熔断器：连续失败 N 次后熔断，冷却期间自动跳过。
// 复用 kline.js 现有的 501/456 即时熔断语义，抽象为通用模块。
// 501 = 腾讯 WAF 反爬页，456 = 新浪 IP 级封禁。

class CircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 300000, tripOnStatus = [501, 456] } = {}) {
    this._threshold = failureThreshold;
    this._cooldown = cooldownMs;
    this._tripOnStatus = new Set(tripOnStatus);
    this._failures = new Map();      // key → { count, firstFailAt }
    this._blockedUntil = new Map();  // key → timestamp
  }

  isAvailable(key) {
    const until = this._blockedUntil.get(key) || 0;
    if (Date.now() < until) return false;
    return true;
  }

  recordSuccess(key) {
    this._failures.delete(key);
    this._blockedUntil.delete(key);
  }

  recordFailure(key, err) {
    // 命中即时熔断状态码（501/456）：直接熔断
    const status = err && (err.status || err.httpStatus || (err.response && err.response.status));
    if (status != null && this._tripOnStatus.has(status)) {
      this._blockedUntil.set(key, Date.now() + this._cooldown);
      this._failures.delete(key);
      return;
    }
    // 累计失败计数
    const f = this._failures.get(key) || { count: 0, firstFailAt: Date.now() };
    f.count++;
    if (f.count >= this._threshold) {
      this._blockedUntil.set(key, Date.now() + this._cooldown);
      this._failures.delete(key);
    } else {
      this._failures.set(key, f);
    }
  }

  // 测试/诊断用：重置所有状态
  reset() {
    this._failures.clear();
    this._blockedUntil.clear();
  }
}

module.exports = { CircuitBreaker };