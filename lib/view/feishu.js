// 飞书推送：官方 SDK + App Bot 模式。token 自动管理，支持卡片/图片。
const lark = require('@larksuiteoapi/node-sdk');
const fs = require('fs');

const RETRY_DELAYS = [5000, 15000, 30000]; // 5s/15s/30s

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createFeishuClient(config, logger) {
  const client = new lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    domain: config.feishu.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
  });
  const chatId = config.feishu.chatId;

  async function sendCard(cardJson) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const res = await client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'interactive',
            content: JSON.stringify(cardJson),
          },
        });
        if (res.code === 0) {
          logger && logger.info('飞书卡片发送成功');
          return true;
        }
        lastErr = new Error(`飞书 code=${res.code} msg=${res.msg}`);
        logger && logger.warn(`飞书发送失败 code=${res.code} msg=${res.msg}`);
        // 230002 未入群不重试
        if (res.code === 230002) break;
      } catch (e) {
        lastErr = e;
        logger && logger.warn(`飞书请求异常 attempt=${attempt}`, e.message);
      }
      if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
    }
    // 回退 text
    logger && logger.warn('飞书卡片发送失败，回退 text');
    try {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '【A股大盘拥挤度监控】卡片发送失败，详见日志' }) },
      });
    } catch (e) {
      logger && logger.error('飞书 text 回退也失败', e.message);
    }
    return false;
  }

  async function sendCards(cardJsons) {
    for (const card of cardJsons) {
      await sendCard(card);
      await sleep(1000); // 避免短时连发
    }
  }

  async function uploadImage(imagePath) {
    const res = await client.im.image.create({
      data: { image_type: 'message', image: fs.createReadStream(imagePath) },
    });
    return res.data && res.data.image_key;
  }

  async function sendTest() {
    const card = {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: 'A股大盘拥挤度监控·测试' } },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: '监控服务启动测试消息。收到此消息说明飞书凭证与入群配置正常。' } }],
    };
    return sendCard(card);
  }

  return { sendCard, sendCards, uploadImage, sendTest };
}

module.exports = { createFeishuClient };
