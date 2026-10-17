/**
 * LiteTranslate — 后台翻译服务（MV3 Service Worker）
 *
 * 为什么翻译请求要放在这里，而不是页面里？
 *   1. 不受网页自身的 CSP（内容安全策略）限制
 *   2. 不占用页面主线程 —— 网页该流畅还是流畅
 *   3. 可以统一做「并发限制 + 缓存」，避免请求风暴
 *
 * 这正是沉浸式翻译卡顿的一半原因：它在页面里对整页 DOM 做文字替换，
 * 产生大面积的渲染脏区，把合成线程（compositor）拖垮。
 */

// ------------------------------------------------------------------
// 默认设置
// ------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  // ★ 默认必须是「装上就能用」★
  //   绝大多数人不会去申请 Key，第一印象决定了他们会不会留下。
  //   所以默认用 MyMemory：不用注册、不用 Key、不用代理。
  //   缺点：额度小（5000 字符/天，填邮箱可到 50000）。
  //   想要更好体验的人，可以自己去面板里换成智谱 GLM（免费但要 Key）
  //   或 DeepSeek（几分钱一页）。
  engine: 'mymemory',      // mymemory | zhipu | google | custom
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  // 翻译模式：
  //   'page'      —— 整页翻译（自动翻 / 或点按钮翻整页）
  //   'selection' —— 只翻我选中的（不翻整页，只用右键 / 快捷键）
  translateMode: 'page',
  // MyMemory 邮箱（填了额度从 5000 提到 50000 字符/天）
  myMemoryEmail: '',
  // 智谱 GLM（永久免费，但需要自己去领 Key）
  zhipuApiKey: '',
  zhipuModel: 'glm-4-flash',   // 实测最稳：0.7–1.7 秒
  // 硅基流动 SiliconFlow（部分模型永久免费，速度快）
  siliconflowApiKey: '',
  // 默认用腾讯混元翻译专用模型：
  //   实测 235–488ms，且译文质量明显最好（"敏捷的""懒惰的"都翻出来）。
  //   注意不要用 Qwen3-8B —— 它带思考模式，实测要 12.7 秒，逐句翻会非常慢。
  siliconflowModel: 'tencent/Hunyuan-MT-7B',
  // DeepSeek（要花钱，但质量最好；主人喜欢就留着）
  deepseekApiKey: '',
  deepseekModel: 'deepseek-flash',   // 注意 deepseek-chat 已于 2026-07-24 废弃
  // DeepSeek（或其他 OpenAI 兼容接口）
  // 注意：deepseek-chat 已于 2026-07-24 废弃，现在要用 deepseek-flash。
  customBaseUrl: 'https://api.deepseek.com',
  customApiKey: '',
  customModel: 'deepseek-flash',

  // ---------------- 图片翻译（看图认字）----------------
  //
  // ★ 为什么单独一个开关？★
  //   它和文字翻译是两套完全不同的东西：
  //     文字翻译 → 几十毫秒、几乎免费、一次能翻几百段
  //     图片翻译 → 十几秒一张、按 token 计费、一次只能一张
  //   混在一起会让用户误以为"开了翻译就会自动翻图"，
  //   结果一页 10 张图要等 2 分钟，还以为卡死了。
  //   所以必须显式开启，且默认关闭。
  imageTranslate: false,
  // 悬停时在图片右上角显示小按钮（方式 B）—— 比"全自动"温和得多
  imageHoverButton: true,
  // 正文里的图要不要也给按钮（默认不给，只给真正的大图）
  imageMinSize: 120,        // 小于这个边长的图忽略（图标、头像）
  // 视觉模型：实测 Qwen3-VL-30B 比 8B 更快(10s vs 31s)且质量更好
  //   GLM-4.5V 会超时；Qwen2.5-VL-32B 已下线(403)；DeepSeek-OCR 输出乱码
  imageModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  // 发给模型前把图压到最长边多少像素
  //   实测 1280px / JPEG 82 → 约 116KB，token 约 900，清晰度够用
  //   调大更清晰但更慢更贵；调小省钱但小字会糊
  imageMaxSide: 1280,
};

// ------------------------------------------------------------------
// 语言代码 → 语言名
//
// 为什么需要这张表？
//   大模型引擎（智谱 / 硅基流动 / DeepSeek / 自定义）是把目标语言
//   写进提示词的：「把下面的文本翻译成___」。
//   原来这里直接塞代码（ja、ko、zh-CN），结果实测发现：
//     · 智谱 glm-4-flash 认识 "ja" ✅
//     · 硅基流动 tencent/Hunyuan-MT-7B 不认识 "ja" ❌
//       —— 它会把英文翻成中文，等于没翻（实测复现 3 次）
//     · Qwen2.5-7B 更糟，输出乱码 "朝isée、友人よ。"
//   换成语言名（"日语"）之后，两个模型都立刻正确了。
//   所以统一用语言名，不再赌模型认不认得代码。
//
// 注意：谷歌和 MyMemory 走的是 URL 参数（要代码，不要语言名），
//       它们不走这张表。
// ------------------------------------------------------------------
const LANG_NAME = {
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  it: '意大利语',
  pt: '葡萄牙语',
  ar: '阿拉伯语',
};

// 把语言代码换成语言名；表里没有就原样返回（自定义语言不至于崩）
function langName(code) {
  const c = (code || '').trim();
  return LANG_NAME[c] || LANG_NAME[c.toLowerCase()] || c;
}

// ------------------------------------------------------------------
// 引擎 1：谷歌翻译公开端点
// 这是 Chrome 官方翻译扩展内部用的那一个，不需要 key。
// 缺点：需要你的网络能访问 google。
// ------------------------------------------------------------------
async function translateGoogle(text, from, to) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx' +
    '&sl=' + encodeURIComponent(from) +
    '&tl=' + encodeURIComponent(to) +
    '&dt=t' +
    '&q=' + encodeURIComponent(text);

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const data = await res.json();
  // 返回格式： [[["译文","原文",null,null,10], ...], null, "en", ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('返回格式异常');
  }
  return data[0].map((seg) => (seg && seg[0]) || '').join('');
}

// ------------------------------------------------------------------
// 引擎 2：MyMemory（无需 Key、无需代理）
//
// 实测（2026-10-13，用户机器，未挂代理）：HTTP 200 可用。
// 限制：单次查询有长度上限（约 500 字节），官方建议每天 5000 词左右。
//       所以这里做了自动分段，避免长段落直接失败。
// ------------------------------------------------------------------
const MYMEMORY_MAX = 450; // 保守取 450 字节，留余量

/** 按句子边界把长文本切成若干段（尽量不切坏句子） */
function splitForMyMemory(text, limit) {
  const parts = [];
  let buf = '';

  // 先按句子切
  const sentences = text.split(/(?<=[.!?;:])\s+/);

  for (const s of sentences) {
    // 单句本身就超长 → 硬切
    if (byteLen(s) > limit) {
      if (buf) { parts.push(buf); buf = ''; }
      let rest = s;
      while (byteLen(rest) > limit) {
        let cut = Math.min(rest.length, limit);
        // 尽量切在空格处
        const sp = rest.lastIndexOf(' ', cut);
        if (sp > limit * 0.5) cut = sp;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) buf = rest;
      continue;
    }

    if (buf && byteLen(buf + ' ' + s) > limit) {
      parts.push(buf);
      buf = s;
    } else {
      buf = buf ? buf + ' ' + s : s;
    }
  }
  if (buf) parts.push(buf);
  return parts.filter((p) => p.trim());
}

/** UTF-8 字节长度 */
function byteLen(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

async function translateMyMemory(text, from, to) {
  const src = from === 'auto' ? 'en' : from.split('-')[0];
  const tgt = to.split('-')[0];
  const langpair = src + '|' + tgt;

  // ★ 关键：带上邮箱，MyMemory 的每日额度会从 5000 字符提到 50000 字符（10 倍）。
  //   这是官方支持的参数，不需要注册、不需要付费。
  const stored = await chrome.storage.local.get({ myMemoryEmail: '' });
  const email = String(stored.myMemoryEmail || '').trim();

  const chunks = splitForMyMemory(text, MYMEMORY_MAX);
  const out = [];

  for (const chunk of chunks) {
    let url =
      'https://api.mymemory.translated.net/get' +
      '?q=' + encodeURIComponent(chunk) +
      '&langpair=' + encodeURIComponent(langpair);

    // 填了邮箱就带上，额度直接涨 10 倍
    if (email && /@/.test(email)) {
      url += '&de=' + encodeURIComponent(email);
    }

    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();

    // MyMemory 出错时也可能返回 200，所以要看 responseStatus
    const status = data && data.responseStatus;
    const translated =
      data && data.responseData && data.responseData.translatedText;

    if (!translated) {
      throw new Error((data && data.responseDetails) || '返回里没有译文');
    }
    if (status && Number(status) !== 200) {
      throw new Error(String(data.responseDetails || ('状态 ' + status)));
    }

    out.push(String(translated).trim());
  }

  return out.join(' ');
}

// ------------------------------------------------------------------
// 引擎 2.5：智谱 GLM（免费模型，需注册拿 Key）
//
// 为什么加它？
//   GLM-4-Flash 是【永久免费】的（不是限时活动），不用充值就能用。
//   适合当"不想花钱时的主力"。
//
// 它为什么慢？（官方数据 + 实测）
//   ★ 免费模型的并发限制是【1 并发】—— 同一时间只能处理一个请求。
//   插件的并发是 3，撞上它就会排队，所以感觉"一句一句往外蹦"。
//   → 本插件对智谱会把并发单独降到 1（见 content.js 的 engineLimits）。
//
// 端点：https://open.bigmodel.cn/api/paas/v4/chat/completions
//   （实测返回 401 = 路径正确，只差 Key）
// 模型 ID（第三方实测可用性）：
//   glm-4-flash       0.7–1.7 秒，最稳（推荐）
//   glm-4-flash-250414 同上，带日期版本
//   glm-4.7-flash     7–10 秒，且约六成请求被限流（不推荐）
//   glm-4v-flash      免费图像理解模型（以后做漫画翻译可用）
// ------------------------------------------------------------------
const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';

/**
 * 翻译引擎的系统提示词（所有引擎共用一份）。
 *
 * ★ 为什么抽出来？★
 *   以前这段在 4 个引擎里各写了一遍，内容一样但各写各的。
 *   改一处就得改四处，很容易漏。抽成一份，改一处全生效。
 *
 * ★ 2026-10-16 加了什么？★
 *   主人截图反馈：全翻译模式下，模型开始"解释"而不是"翻译"——
 *     原文：Dyldystreamer（某 UP 主名字）
 *     译文：「Dyldystreamer」可以翻译为"每日直播者"或"日常直播者"
 *     原文：softvoice
 *     译文：softvoice（这个词汇在标准英语词典中并不存在…）
 *
 *   根因：模型遇到翻译不了的词（人名、频道名）会"心虚"，
 *         一虚就开始解释 —— 它是想帮忙，但用户要的只是一行译文。
 *
 *   修法：提前给它许可 —— 翻不了就原样抄，不丢人。
 *         这几条都是"格式要求"而非"知识要求"，
 *         任何模型都能遵守，不受能力影响。
 *
 * @param {string} to 目标语言代码
 */
function translateSystemPrompt(to) {
  return (
    '你是翻译引擎。把用户给的文本翻译成' + langName(to) + '。\n' +
    '严格按下面几条来：\n' +
    '1. 只输出译文本身，不要解释、不要加引号、不要重复原文。\n' +
    '2. 遇到人名、频道名、用户名、品牌名、网址 —— ' +
    '无法翻译就**原样输出**，不要音译、不要意译、不要说明。\n' +
    '3. 遇到你不认识的词 —— 原样输出，不要猜它的意思，' +
    '不要说"这个词不存在"或"可能是…"。\n' +
    '4. 缩写（如 IRL、ASMR）—— 有通用译法就翻，没有就原样输出。\n' +
    '5. 绝对不要出现「可以翻译为」「意思是」「这个词汇」「指的是」' +
    '这类解释性文字。\n' +
    '6. 如果这段内容本来就不需要翻译 —— 原样输出即可。'
  );
}

async function translateZhipu(text, from, to, s) {
  const key = (s.zhipuApiKey || '').trim();
  if (!key) throw new Error('还没填智谱 API Key（去 open.bigmodel.cn 免费领）');

  const model = (s.zhipuModel || 'glm-4-flash').trim();

  const res = await fetch(ZHIPU_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: translateSystemPrompt(to) },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new Error('智谱免费模型繁忙（1 并发限制），稍等再试');
    }
    if (res.status === 401) {
      throw new Error('智谱 Key 无效或未填（401）');
    }
    throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
  }

  const data = await res.json();
  const out = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('返回里没有译文');
  return String(out).trim();
}

// ------------------------------------------------------------------
// 引擎 3：硅基流动 SiliconFlow
//
// 为什么加它？—— 它是「治慢」的那个。
//   智谱免费模型限 1 并发，一句话一句话往外蹦；
//   硅基流动 L0（新用户默认档）是 1000 RPM / 40000 TPM
//   （官方限速文档：docs.siliconflow.com/cn/userguide/rate-limits），
//   所以插件可以把并发拉满，翻起来快得多。
//
// 端点：https://api.siliconflow.cn/v1/chat/completions
//   （实测无 Key 返回 401 = 路径正确）
//
// 关于实名认证（要如实告诉用户）：
//   官方推荐官计划页写明"完成实名认证后方可获得奖励及使用平台部分功能"；
//   但官方限速文档又说"未完成实名认证用户"对 DeepSeek-R1/V3 限 100 次/天 ——
//   说明未实名也能用，只是限制更严。所以面板里写"可能需要实名"。
//
// 模型名要用「完整路径」写法，例如 Qwen/Qwen3-8B（不是 qwen3-8b）。
// ------------------------------------------------------------------
const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';

async function translateSiliconFlow(text, from, to, s) {
  const key = (s.siliconflowApiKey || '').trim();
  if (!key) throw new Error('还没填硅基流动的 API Key（去 cloud.siliconflow.cn 领）');

  const model = (s.siliconflowModel || 'tencent/Hunyuan-MT-7B').trim();

  const res = await fetch(SILICONFLOW_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: translateSystemPrompt(to) },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error('硅基流动 Key 无效或未填（401）');
    }
    if (res.status === 429) {
      throw new Error('硅基流动限流了（429），稍等再试');
    }
    if (res.status === 404 || /model/i.test(t)) {
      throw new Error('模型名不对（要用 Qwen/Qwen3-8B 这种带斜杠的写法）: ' +
        t.slice(0, 100));
    }
    throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
  }

  const data = await res.json();
  const out = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('返回里没有译文');
  return String(out).trim();
}

// ------------------------------------------------------------------
// 引擎 4：DeepSeek（要花钱，但质量最好）
//
// 既然主人喜欢，那就加上 —— 用得少不代表不该有。
//
// 端点：https://api.deepseek.com/chat/completions
// 模型（注意 2026-07-24 起 deepseek-chat 已废弃）：
//   deepseek-flash   便宜快（输入 1–2 元 / 输出 4–8 元 每百万 tokens）
//   deepseek-v4-pro  强但贵约 4 倍（输入 4.5–9 / 输出 13.5–27）
//   翻译一页网页约 2000 tokens ≈ 1 分钱，用 flash 就够
// 省钱技巧：空闲时段（非工作日 9-12、14-18 点）价格减半。
// ------------------------------------------------------------------
const DEEPSEEK_BASE = 'https://api.deepseek.com';

async function translateDeepSeek(text, from, to, s) {
  const key = (s.deepseekApiKey || '').trim();
  if (!key) throw new Error('还没填 DeepSeek API Key（去 platform.deepseek.com 申请）');

  const model = (s.deepseekModel || 'deepseek-flash').trim();

  const res = await fetch(DEEPSEEK_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.1,
      // 翻译不需要长输出，设个上限避免模型啰嗦
      max_tokens: 2048,
      messages: [
        { role: 'system', content: translateSystemPrompt(to) },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error('DeepSeek Key 无效或未填（401）');
    }
    if (res.status === 402) {
      throw new Error('DeepSeek 账户余额不足（402），去 platform.deepseek.com 充值');
    }
    if (res.status === 429) {
      throw new Error('DeepSeek 限流了（429），稍等再试');
    }
    throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
  }

  const data = await res.json();
  const out = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('返回里没有译文');
  return String(out).trim();
}

// ------------------------------------------------------------------
// 引擎 5：自定义（任何 OpenAI 兼容接口）
// 适合：硅基流动的其它模型 / OpenAI 等
// ------------------------------------------------------------------
async function translateCustom(text, from, to, s) {
  if (!s.customBaseUrl) throw new Error('还没填自定义接口地址');
  if (!s.customApiKey) throw new Error('还没填 API Key');

  const base = s.customBaseUrl.replace(/\/+$/, '');
  const model = s.customModel || 'gpt-4o-mini';

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + s.customApiKey,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0,
      messages: [
        { role: 'system', content: translateSystemPrompt(to) },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
  }
  const data = await res.json();
  const out = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('返回里没有译文');
  return String(out).trim();
}

// ------------------------------------------------------------------
// 图片翻译（看图认字）
//
// 和文字翻译完全不同的地方：
//   · 输入是一张图（content.js 已用 canvas 压成 data URL）
//   · 一次只能一张，十几秒才回来
//   · 提示词必须写得很死，否则模型会自己"解释"而不是"翻译"
//
// ★ 提示词为什么这么啰嗦？★
//   实测踩坑：只写「翻译图片里的文字」时，模型看到零碎内容（如标签列表）
//   会自作主张输出「**译文：**」「**解释：**」「**重复原文：**」，
//   还附上一大段科普，在页面上撑出几百字的黑框。
//   所以这里明确要求：只输出「原文 → 译文」，不要任何其它内容。
//
// ★ 模型选型（2026-10-14 实测，同一张漫画封面）★
//   Qwen3-VL-30B      10.1s  ✅ 「하프 오브 미 → 我的一半」最准（选它）
//   Qwen3-VL-8B       30.9s  ⚠️ 更慢且更差（「半个我」）
//   GLM-4.5V          超时    ✗
//   Qwen2.5-VL-32B    403     ✗ 模型已下线
//   DeepSeek-OCR      0.4s    ✗ 输出乱码
//   有意思的是 30B 比 8B 快 3 倍 —— 小模型反而更慢，别按"参数小就快"选。
// ------------------------------------------------------------------
const VISION_PROMPT =
  '把这张图片里出现的所有文字提取出来，翻译成{to}。\n' +
  '严格按「原文 → 译文」格式输出，每行一条。\n' +
  '不要解释、不要总结、不要加"译文："这样的前缀、不要重复原文段落。\n' +
  '如果图里没有文字，只回答：没有找到文字。';

/**
 * 翻译一张图片里的文字。
 *
 * @param {string} imageDataUrl  形如 data:image/jpeg;base64,xxx
 * @param {object} settings      插件设置
 * @returns {Promise<{text:string, ms:number, model:string}>}
 */
async function translateImage(imageDataUrl, settings) {
  const key = (settings.siliconflowApiKey || '').trim();
  if (!key) {
    throw new Error('图片翻译需要硅基流动的 Key（去 cloud.siliconflow.cn 领），' +
      '目前只有它提供免费的看图模型');
  }
  if (!imageDataUrl || imageDataUrl.indexOf('data:image/') !== 0) {
    throw new Error('图片数据无效（可能是跨域图，无法读取像素）');
  }

  const model = (settings.imageModel ||
    'Qwen/Qwen3-VL-30B-A3B-Instruct').trim();
  const to = LANG_NAME[settings.targetLang] || '简体中文';

  const t0 = Date.now();
  const res = await fetch(SILICONFLOW_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.1,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT.replace('{to}', to) },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('硅基流动 Key 无效（401）');
    if (res.status === 402) {
      throw new Error('硅基流动余额不足（402），充值后即可用');
    }
    if (res.status === 429) throw new Error('硅基流动限流了（429），稍等再试');
    if (res.status === 404 || /model/i.test(t)) {
      throw new Error('图片模型名不对：' + t.slice(0, 100));
    }
    throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
  }

  const data = await res.json();
  const out = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;

  return {
    text: String(out || '').trim(),
    ms: Date.now() - t0,
    model: model,
  };
}

// ------------------------------------------------------------------
// 统一入口
// ------------------------------------------------------------------
async function doTranslate(text, settings) {
  const from = settings.sourceLang || 'auto';
  const to = settings.targetLang || 'zh-CN';
  const engine = settings.engine || 'mymemory';

  if (engine === 'zhipu') return translateZhipu(text, from, to, settings);
  if (engine === 'siliconflow') return translateSiliconFlow(text, from, to, settings);
  if (engine === 'deepseek') return translateDeepSeek(text, from, to, settings);
  if (engine === 'mymemory') return translateMyMemory(text, from, to);
  if (engine === 'custom') return translateCustom(text, from, to, settings);
  return translateGoogle(text, from, to);
}

// ------------------------------------------------------------------
// 每个引擎的「建议并发数」
//
// ★ 这张表就是「快慢」的分界线 ★
//   智谱免费模型只有 1 并发，用 3 并发去撞只会互相排队 —— 所以要降到 1。
//   硅基流动 L0 有 1000 RPM，可以放心拉满。
// ------------------------------------------------------------------
const ENGINE_CONCURRENCY = {
  zhipu: 1,          // 免费模型 1 并发（官方硬限制）
  siliconflow: 5,    // L0 有 1000 RPM，可以拉满
  deepseek: 3,       // 付费但便宜，3 并发够用
  mymemory: 2,       // 免费服务，别打太猛
  google: 3,
  custom: 3,
};

// ------------------------------------------------------------------
// 右键菜单 + 快捷键
//
// 为什么不用页面内的 keydown 监听 Alt+T？
//   因为 Chrome/Edge 会把「Alt + 字母」当成浏览器自己的菜单访问键，
//   事件在页面收到之前就被浏览器吃掉了 —— 所以那种做法在浏览器里
//   基本不会生效。
//
// 正确做法是用 chrome.commands（浏览器级快捷键，不受页面影响）
// 和 chrome.contextMenus（右键菜单）。
// ------------------------------------------------------------------

const MENU_ID = 'lite-translate-selection';
// 「翻译鼠标所指的图」—— 一项通吃：<img> / 背景图 / canvas
//
// ★ 2026-10-16 合并 ★
//   以前有两项：MENU_IMAGE_ID（contexts:['image']，右键真正的 <img>）
//   和 MENU_HERE_ID（contexts:['all']，兜底）。
//   问题：在真图上报右键会**同时命中两项**，Chrome 于是把它们
//   折叠成一个子菜单 —— 同一个功能，位置不同、样子就不同，
//   用户会觉得"有时候有有时候没有"。
//   现在只留一项（contexts:['all']），由内容脚本的
//   findImageLikeAtPoint 自己判断鼠标底下是什么图。
//   它本来就能处理 <img>（第①阶段爬祖先就能找到），所以够用。
const MENU_HERE_ID = 'lite-translate-image-here';

/** 创建右键菜单（幂等） */
function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // ① 选中文字 → 翻译这段
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用 LiteTranslate 翻译这段',
      contexts: ['selection'],
    });
    // ② 翻译鼠标所指的图（点哪儿都出现，自己判断底下有没有图）
    chrome.contextMenus.create({
      id: MENU_HERE_ID,
      title: '翻译这张图（背景图 / canvas 也能用）',
      contexts: ['all'],
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);

/**
 * 给指定标签页发「翻译选区」指令。
 *
 * ★ 关键：把 selectionText 一起带过去。
 *
 * 为什么？
 *   用户点右键菜单的那一刻，浏览器往往已经把页面里的选区折叠了，
 *   内容脚本再调 window.getSelection() 会拿到空字符串 ——
 *   表现就是「右键了但没反应」。
 *   而 chrome.contextMenus 的回调里直接就有 info.selectionText，
 *   这是最可靠的来源，所以优先用它。
 */
async function askTabToTranslateSelection(tabId, selectionText, point) {
  const payload = {
    type: 'translate-selection',
    text: selectionText || '',
    point: point || null,
  };

  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    // 页面里没有内容脚本（比如刚装完还没刷新）—— 注入一次再发
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.css'],
      }).catch(() => {});
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (e2) {
      // 有些页面（chrome:// 等）不允许注入，静默放弃
    }
  }
}

// 右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab && tab.id != null) {
    // info.selectionText 就是用户选中的文字，直接带过去
    askTabToTranslateSelection(tab.id, info.selectionText, null);
    return;
  }

  // 右键「翻译这张图」→ 交给内容脚本自己找鼠标底下的图
  //
  // ★ 为什么不让后台找？★
  //   后台拿不到「鼠标在哪个元素上」这个信息。
  //   只有内容脚本知道自己刚记录过的鼠标位置（见 lastRightClick）。
  //
  // ★ 为什么不再区分 <img> 和背景图？★
  //   2026-10-16 合并成一项。内容脚本的 findImageLikeAtPoint
  //   本来就能处理 <img>（第①阶段爬祖先就能找到），
  //   分成两项反而会被 Chrome 折叠成子菜单，位置不一致。
  if (info.menuItemId === MENU_HERE_ID && tab && tab.id != null) {
    // ★ 走和「翻译这段」一样的注入兜底 ★
    //
    // 2026-10-16 修：以前这里只 sendMessage + console.warn，
    //   一旦页面里没有内容脚本（最常见的情况：刚在 edge://extensions
    //   重载过扩展，已打开的页面里旧脚本就失效了），消息就静默丢失，
    //   用户看到的是「点了没反应」—— 完全不知道发生了什么。
    //   现在改成：发失败就补注入一次再发；再失败就给页面一个可见提示。
    sendImageHereWithFallback(tab.id);
  }
});

/**
 * 让页面翻译「鼠标所指的图」。
 *
 * ★ 为什么要这个函数？★
 *   右键菜单是在后台响应的，但真正干活的 content.js 可能不在页面里：
 *     · 刚重载扩展，已打开的页面里旧脚本已失效
 *     · 页面是重载之后才打开的、但脚本注入失败
 *   这时 sendMessage 会抛错。不处理的话用户只看到"没反应"。
 *
 *   处理办法分三步：
 *     ① 直接发
 *     ② 失败了 → 补注入 content.js + content.css，再发一次
 *     ③ 还失败 → 在页面上弹一个提示（用 scripting 注入一小段代码，
 *        因为此时 content.js 本身就不在，没法用它的提示函数）
 *
 * @param {number} tabId
 */
async function sendImageHereWithFallback(tabId) {
  const payload = { type: 'translate-image-here' };

  // ① 先直接发
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return;
  } catch (e) { /* 内容脚本不在，走兜底 */ }

  // ② 补注入再发
  //
  // ★ 为什么要先写个标记？★
  //   补注入的 content.js 会看到 window.__liteTranslateLoaded=true
  //   （页面里之前注入过），于是它走"重复注入"分支，
  //   只重试一件事就 return 了。
  //   所以注入前要先告诉它"这次要重试图片翻译"，
  //   否则它会去重试选区翻译，图片这事就没人管（表现为点了没反应）。
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      // 在页面里打个标记：待办是「翻译鼠标所指的图」
      func: () => { window.__liteTranslatePending = 'image-here'; },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await chrome.scripting
      .executeScript({ target: { tabId }, files: ['content.css'] })
      .catch(() => {});
    // 注入后脚本需要一丁点时间注册监听器
    await new Promise((r) => setTimeout(r, 60));
    await chrome.tabs.sendMessage(tabId, payload);
    return;
  } catch (e) { /* 注入也不行，走提示 */ }

  // ③ 实在不行 → 在页面上弹可见提示
  //    为什么不用 content.js 的 showImageError？
  //    因为它此刻就不在页面里。所以这里内联一小段代码。
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const d = document.createElement('div');
        d.textContent =
          'LiteTranslate：请先刷新这个页面（Ctrl+R），再右键翻译图片。';
        d.style.cssText =
          'position:fixed;left:50%;top:16px;transform:translateX(-50%);' +
          'z-index:2147483647;background:#b91c1c;color:#fff;' +
          'padding:10px 18px;border-radius:8px;font:14px/1.5 sans-serif;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.3);';
        document.documentElement.appendChild(d);
        setTimeout(() => d.remove(), 5000);
      },
    })
    .catch(() => {
      // 连注入提示都不允许（chrome:// 等特殊页面），只能记日志
      console.warn('[LiteTranslate] 无法在此页面注入，请刷新页面后重试');
    });
}

// 浏览器级快捷键
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) askTabToTranslateSelection(tab.id, '', null);
});

// ------------------------------------------------------------------
// 缓存：同一句话不重复请求（这也是「轻量」的一部分）
// ------------------------------------------------------------------
const cache = new Map();
const CACHE_MAX = 3000;

function cacheKey(text, s) {
  return s.engine + '|' + s.targetLang + '|' + text;
}

// ------------------------------------------------------------------
// 消息处理
// ------------------------------------------------------------------
/** 读取设置（与默认值合并） */
async function getSettings(overrides) {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, stored, overrides || {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // ================= 翻译请求 =================
  if (msg.type === 'translate') {
    (async () => {
      try {
        const settings = await getSettings();

        const text = String(msg.text || '').trim();
        if (!text) {
          sendResponse({ ok: true, text: '' });
          return;
        }

        const key = cacheKey(text, settings);
        if (cache.has(key)) {
          sendResponse({ ok: true, text: cache.get(key), cached: true });
          return;
        }

        const result = await doTranslate(text, settings);

        cache.set(key, result);
        if (cache.size > CACHE_MAX) {
          // 简单的先进先出淘汰
          const first = cache.keys().next().value;
          cache.delete(first);
        }

        sendResponse({ ok: true, text: result });
      } catch (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      }
    })();

    return true; // 异步响应
  }

  // ================= 图片翻译（看图认字）=================
  //
  // ★ 为什么要单独一条消息，不并进上面的 'translate'？★
  //   因为两者差别太大：文字翻译是几十毫秒的小请求，
  //   图片翻译要十几秒、按 token 计费、还要处理压缩。
  //   分开走，超时、报错、缓存策略都能各自处理，互不影响。
  //
  // ★ 为什么不做缓存？★
  //   同一张图很少翻两次；而且 data URL 很长，
  //   塞进 Map 会把内存撑爆（一张 1280px 的图 base64 就有 150KB）。
  if (msg.type === 'translate-image') {
    (async () => {
      try {
        const settings = await getSettings();

        // ★ 开关检查：分两种情况 ★
        //   · 自动/悬停触发的图片翻译 → 必须检查总开关
        //     （它会自己跑，用户可能没意识到，所以要挡住防烧钱）
        //   · 截图翻译（manual）→ 跳过检查
        //     （用户亲手点了按钮、亲手拖了框，意图非常明确，
        //       再问"你确定要翻译吗"是多余的）
        //
        // ★ 为什么跳过检查就够了、不该顺手改用户的设置？★
        //   曾经在这里写过「手动用时顺手把 imageTranslate 打开」，
        //   结果用户截图翻译完，发现面板上「翻译图片里的文字」
        //   自己打勾了 —— 很困惑；更糟的是如果「自动翻译」也开着，
        //   接下来满页的图会自己开始翻、自己烧额度。
        //   截图翻译只需要"这一次不被拦住"，不需要动用户的设置。
        const manual = msg.manual === true;
        if (!settings.imageTranslate && !manual) {
          sendResponse({ ok: false, error: '图片翻译未开启（在插件面板里打开）' });
          return;
        }

        const r = await translateImage(msg.imageDataUrl, settings);
        sendResponse({ ok: true, text: r.text, ms: r.ms, model: r.model });
      } catch (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      }
    })();

    return true;
  }

  // ================= 截图翻译 =================
  //
  // ★ 为什么整个流程要由后台来指挥？★
  //   popup 是个会关的页面 —— 用户鼠标一移到网页上准备拖框，
  //   popup 立刻被销毁，里面正在跑的 async 代码就断了。
  //   后台 Service Worker 是常驻的，能跨过 popup 的生死。
  //
  // ★ 为什么截屏必须在后台？★
  //   captureVisibleTab 是扩展级 API，页面里调不到。
  //   我们有 <all_urls> host 权限，文档明确说这样可以在后台调。
  //
  // ★ 为什么用「两条消息」而不是一次请求-响应？★
  //   用户拖框要好几秒。如果后台一直 await 页面响应，
  //   sendResponse 拖太久消息通道会被 Chrome 关掉。
  //   所以拆成两步：
  //     后台 → 页面：pick-area（叫它进框选模式）
  //     页面 → 后台：shot-area-picked（拖完了，这是坐标）
  //
  // 完整链路：
  //   ① popup 点按钮 → shot-start
  //   ② 后台叫页面进框选模式（pick-area），记下是哪个标签页
  //   ③ 用户拖完框 → 页面推 shot-area-picked 给后台
  //   ④ 后台截屏，把「整屏图 + 坐标」发给页面
  //   ⑤ 页面裁剪 → 调模型 → 贴译文（要用 canvas，只能页面做）
  let pendingShotTabId = null;   // 正在等哪個标签页框选

  if (msg.type === 'shot-start') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.id == null) {
          sendResponse({ ok: false, error: '拿不到当前标签页' });
          return;
        }
        pendingShotTabId = tab.id;
        // 叫页面进框选模式。这条消息的响应只是「收到了」，
        // 真正的坐标稍后由 shot-area-picked 送回来。
        await chrome.tabs.sendMessage(tab.id, { type: 'pick-area' });
        sendResponse({ ok: true, started: true });
      } catch (err) {
        pendingShotTabId = null;
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      }
    })();

    return true;
  }

  // 页面拖完框了 → 这里才是真正拿坐标的地方
  if (msg.type === 'shot-area-picked') {
    (async () => {
      const tabId = (sender && sender.tab && sender.tab.id != null)
        ? sender.tab.id
        : pendingShotTabId;
      const area = msg.area;
      pendingShotTabId = null;

      if (!tabId || !area) {
        // 用户取消了 —— 静默结束（不要弹错误，取消不是失败）
        sendResponse({ ok: true, cancelled: true });
        return;
      }

      // 截当前标签页的可见区域
      let full;
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        full = await chrome.tabs.captureVisibleTab(tabInfo.windowId, {
          format: 'png',
        });
      } catch (e) {
        // 截图失败要告诉用户 —— 在页面上弹提示（popup 已经关了）
        await chrome.tabs
          .sendMessage(tabId, {
            type: 'shot-failed',
            error: '截图失败：' + ((e && e.message) || e),
          })
          .catch(() => {});
        sendResponse({ ok: false, error: '截图失败' });
        return;
      }

      // 把整屏图 + 坐标交给页面去裁（页面有 canvas，后台没有）
      await chrome.tabs
        .sendMessage(tabId, {
          type: 'shot-crop-and-go',
          fullImage: full,
          area: area,
        })
        .catch(() => {});

      sendResponse({ ok: true });
    })();

    return true;
  }
  // ================= 测试引擎连通性 =================
  if (msg.type === 'ping-engine') {
    (async () => {
      try {
        const overrides = Object.assign({}, msg.overrides || {});
        if (msg.engine) overrides.engine = msg.engine;

        const settings = await getSettings(overrides);
        const out = await doTranslate('Hello, world.', settings);
        sendResponse({ ok: true, text: out });
      } catch (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      }
    })();

    return true;
  }

  // ================= 一次性测所有引擎 =================
  if (msg.type === 'ping-all') {
    (async () => {
      const settings = await getSettings();
      const engines = [
        { id: 'mymemory', label: 'MyMemory（无需代理）' },
        { id: 'google', label: '谷歌（需代理）' },
      ];

      // 填了 Key 才测对应的 AI 引擎
      if (settings.zhipuApiKey) {
        engines.push({ id: 'zhipu', label: '智谱 GLM' });
      }
      if (settings.siliconflowApiKey) {
        engines.push({ id: 'siliconflow', label: '硅基流动' });
      }
      if (settings.deepseekApiKey) {
        engines.push({ id: 'deepseek', label: 'DeepSeek' });
      }
      if (settings.customBaseUrl && settings.customApiKey) {
        engines.push({ id: 'custom', label: '自定义 AI' });
      }

      const results = [];
      for (const e of engines) {
        const s = Object.assign({}, settings, { engine: e.id });
        try {
          const text = await doTranslate('Hello, world.', s);
          results.push({ id: e.id, label: e.label, ok: true, text });
        } catch (err) {
          results.push({
            id: e.id,
            label: e.label,
            ok: false,
            error: (err && err.message) || String(err),
          });
        }
      }
      sendResponse({ ok: true, results });
    })();

    return true;
  }
});
