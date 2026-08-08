// 共享反爬 HTTP 客户端：随机 UA + 同源限速 + 指数退避重试 + 可选 nid18。
// emData / margin / etfFlow 共用此实例，避免反爬逻辑重复。
const axios = require('axios');
const https = require('https');

// 东财等源证书链在 Node 下偶发校验失败，放宽校验（仅本进程内数据拉取，无敏感交互）
const INSECURE_AGENT = new https.Agent({ rejectUnauthorized: false });

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const BROWSER_HEADERS = {
  Accept: 'application/json, text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Upgrade-Insecure-Requests': '1',
};

const SINA_REFERER_POOL = [
  'https://finance.sina.com.cn/stock/',
  'https://finance.sina.com.cn/realstock/company/',
  'https://finance.sina.com.cn/stock/marketresearch/',
];

const SINA_COOKIE_POOL = [
  'FANCY=0; UOR=finance.sina.com.cn,finance.sina.com.cn,; SINAGLOBAL=205.174.165.80_1723000000.0.0.0; ULV=1723000000000:1:1:1:205.174.165.80_1723000000.0.0.0; Apache=205.174.165.80_1723000000.0.0.0; hxck_webdev=GeneralCount=1',
  'FANCY=1; UOR=finance.sina.com.cn,finance.sina.com.cn,; SINAGLOBAL=183.60.23.41_1723000000.0.0.0; ULV=1723000000000:1:1:1:183.60.23.41_1723000000.0.0.0; Apache=183.60.23.41_1723000000.0.0.0; hxck_webdev=GeneralCount=1',
];

const RETRY_DELAYS = [1000, 3000, 8000]; // 1s/3s/8s
const JITTER = 300; // ±300ms

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUa() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function pickSinaReferer() {
  return SINA_REFERER_POOL[Math.floor(Math.random() * SINA_REFERER_POOL.length)];
}

function pickSinaCookie() {
  return SINA_COOKIE_POOL[Math.floor(Math.random() * SINA_COOKIE_POOL.length)];
}

function isSinaHost(url) {
  return /(?:^|\.)sina\.com\.cn$/i.test(hostOf(url));
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// 携带 HTTP 状态码的错误，调用方可据此区分"反爬封禁"与普通网络错误
class HttpStatusError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.httpStatus = status;
  }
}

function createHttpClient({ maxRetries = 3, proxy = null, nid18Enabled = false, logger = null } = {}) {
  const instance = axios.create({ timeout: 8000, httpsAgent: INSECURE_AGENT });
  if (proxy) {
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      instance.defaults.httpsAgent = new HttpsProxyAgent(proxy);
      logger && logger.info(`HTTP 代理已启用：${proxy}`);
    } catch {
      logger && logger.warn('https-proxy-agent 未安装，忽略 proxy 配置');
    }
  }

  const lastReqByHost = {}; // 同源限速
  let nidCache = { value: null, expireAt: 0 };

  async function fetchNid() {
    if (nidCache.value && Date.now() < nidCache.expireAt) return nidCache.value;
    // 移植自参考 eastmoney_patch.py：POST 设备指纹到 anonflow2 换 nid
    const fp = {
      ua: pickUa(),
      webgl: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)',
      canvas: Array.from({ length: 8 }, () => randInt(0, 255)).join(','),
      screen: `${randInt(1366, 1920)}x${randInt(768, 1080)}`,
    };
    try {
      const res = await axios.post(
        'https://anonflow2.eastmoney.com/backend/api/webreport',
        JSON.stringify(fp),
        { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
      );
      const nid = res.data && res.data.data && res.data.data.nid;
      if (nid) {
        nidCache = { value: nid, expireAt: Date.now() + 20000 };
        return nid;
      }
    } catch (e) {
      logger && logger.warn('获取 nid18 失败', e.message);
    }
    return null;
  }

  async function get(url, { params, headers = {}, referer, source = '', timeout = 8000, maxRetries: reqMaxRetries, sina: sinaOpts = false } = {}) {
    const host = hostOf(url);
    const last = lastReqByHost[host] || 0;
    const gap = Date.now() - last;
    const minGap = isSinaHost(url) && sinaOpts && sinaOpts.minGap
      ? sinaOpts.minGap
      : randInt(800, 1500);
    if (gap < minGap) await sleep(minGap - gap);

    const reqHeaders = {
      ...BROWSER_HEADERS,
      'User-Agent': pickUa(),
      ...headers,
    };
    if (referer) reqHeaders.Referer = referer;
    if (isSinaHost(url) && !headers.Referer) {
      reqHeaders.Referer = pickSinaReferer();
    }
    if (isSinaHost(url) && !headers.Cookie) {
      reqHeaders.Cookie = pickSinaCookie();
    }
    if (nid18Enabled) {
      const nid = await fetchNid();
      if (nid) reqHeaders.Cookie = `nid18=${nid}`;
    }

    const retries = reqMaxRetries != null ? reqMaxRetries : maxRetries;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await instance.get(url, { params, headers: reqHeaders, timeout });
        lastReqByHost[host] = Date.now();
        // 空数据视为失败重试
        if (res.data === null || res.data === undefined || res.data === '') {
          throw new Error('响应数据为空');
        }
        return res.data;
      } catch (e) {
        lastErr = e;
        const code = e.response && e.response.status;
        logger && logger.warn(`请求失败 [${source}] attempt=${attempt}/${retries} ${code || e.message}`);
        // 456 = 新浪 IP 级封禁：短时重试无意义且会加剧封禁，直接抛错交给上层降级
        if (code === 456) {
          throw new HttpStatusError(`数据源反爬封禁(HTTP 456) [${source}]`, 456);
        }
        if (attempt < retries) {
          if (code === 403 || code === 503) {
            // 触发反爬，增加更长冷却再重试
            await sleep(randInt(5000, 10000) + (attempt * 2000));
          } else {
            const base = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
            const jitter = randInt(-JITTER, JITTER);
            await sleep(base + jitter);
          }
        }
      }
    }
    lastReqByHost[host] = Date.now();
    throw lastErr;
  }

  return { get, instance };
}

module.exports = { createHttpClient, UA_POOL, HttpStatusError };
