/**
 * LiteTranslate — 弹出面板
 * 负责：设置读写、开关翻译、显示统计、测试引擎连通性
 */

const $ = (id) => document.getElementById(id);

const els = {
  engine: $('engine'),
  targetLang: $('targetLang'),
  displayMode: $('displayMode'),
  translateMode: $('translateMode'),
  translateScope: $('translateScope'),
  autoTranslate: $('autoTranslate'),
  imageTranslate: $('imageTranslate'),
  imageAuto: $('imageAuto'),
  imageAutoRow: $('imageAutoRow'),
  imageModel: $('imageModel'),
  imgLookRow: $('imgLookRow'),
  imgShowSource: $('imgShowSource'),
  imgTextColor: $('imgTextColor'),
  imgTextColorReset: $('imgTextColorReset'),
  imgBgColor: $('imgBgColor'),
  imgBgColorReset: $('imgBgColorReset'),
  imgFontSize: $('imgFontSize'),
  imgFontSizeVal: $('imgFontSizeVal'),
  autoRow: $('autoRow'),
  myMemoryEmail: $('myMemoryEmail'),
  mmEmailRow: $('mmEmailRow'),
  zhipuBox: $('zhipuBox'),
  zhipuApiKey: $('zhipuApiKey'),
  zhipuModel: $('zhipuModel'),
  siliconflowBox: $('siliconflowBox'),
  siliconflowApiKey: $('siliconflowApiKey'),
  siliconflowModel: $('siliconflowModel'),
  deepseekBox: $('deepseekBox'),
  deepseekApiKey: $('deepseekApiKey'),
  deepseekModel: $('deepseekModel'),
  // 外观 —— 双语对照
  textColor: $('textColor'),
  textColorReset: $('textColorReset'),
  bgColor: $('bgColor'),
  bgColorReset: $('bgColorReset'),
  underlineColor: $('underlineColor'),
  underlineReset: $('underlineReset'),
  fontScale: $('fontScale'),
  fontScaleVal: $('fontScaleVal'),
  fontSize: $('fontSize'),
  fontSizeVal: $('fontSizeVal'),
  scaleBox: $('scaleBox'),
  fixedBox: $('fixedBox'),
  lookPreview: $('lookPreview'),
  lookReset: $('lookReset'),
  // 外观 —— 替换原文（独立）
  replaceUseColor: $('replaceUseColor'),
  replaceColorRow: $('replaceColorRow'),
  replaceTextColor: $('replaceTextColor'),
  replaceColorReset: $('replaceColorReset'),
  replaceUseUnderline: $('replaceUseUnderline'),
  replaceFontScale: $('replaceFontScale'),
  replaceFontScaleVal: $('replaceFontScaleVal'),
  replaceFontSize: $('replaceFontSize'),
  replaceFontSizeVal: $('replaceFontSizeVal'),
  rScaleBox: $('rScaleBox'),
  rFixedBox: $('rFixedBox'),
  replacePreview: $('replacePreview'),
  replaceReset: $('replaceReset'),
  // 外观 —— 面板自身（插件界面，不是网页译文）
  panelSkin: $('panelSkin'),
  panelBg: $('panelBg'),
  panelBgReset: $('panelBgReset'),
  panelImageFile: $('panelImageFile'),
  panelImageClear: $('panelImageClear'),
  panelImageOpts: $('panelImageOpts'),
  panelVeil: $('panelVeil'),
  panelVeilVal: $('panelVeilVal'),
  panelText: $('panelText'),
  panelTextReset: $('panelTextReset'),
  panelReset: $('panelReset'),
  customBox: $('customBox'),
  customBaseUrl: $('customBaseUrl'),
  customApiKey: $('customApiKey'),
  customModel: $('customModel'),
  customModelBox: $('customModelBox'),
  customModelManual: $('customModelManual'),
  toggle: $('toggle'),
  status: $('status'),
  test: $('test'),
  testAll: $('testAll'),
  manualIn: $('manualIn'),
  manualOut: $('manualOut'),
  manualGo: $('manualGo'),
  manualCopy: $('manualCopy'),
};

let currentTabId = null;
let isOn = false;

// ------------------------------------------------------------------
// 设置
// ------------------------------------------------------------------
async function loadSettings() {
  const s = await chrome.storage.local.get({
    engine: 'mymemory',
    targetLang: 'zh-CN',
    displayMode: 'bilingual',
    translateMode: 'page',
    translateScope: 'precise',   // 翻译力度：precise 精翻 / full 全翻译
    autoTranslate: false,
    myMemoryEmail: '',
    zhipuApiKey: '',
    zhipuModel: 'glm-4-flash',
    siliconflowApiKey: '',
    siliconflowModel: 'tencent/Hunyuan-MT-7B',
    imageModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    deepseekApiKey: '',
    deepseekModel: 'deepseek-flash',
    customBaseUrl: 'https://api.deepseek.com',
    customApiKey: '',
    customModel: 'deepseek-flash',
    // 图片翻译（看图认字）
    imageTranslate: false,
    imageAuto: false,
    // 图片译文的外观
    imgShowSource: false,      // 默认只要中文
    imgTextColor: '#ffffff',   // 译文白字
    imgBgColor: '#111827',     // 深色底
    imgFontSize: 15,           // 译文字号
  });
  els.engine.value = s.engine;
  els.targetLang.value = s.targetLang;
  els.displayMode.value = s.displayMode;
  els.translateMode.value = s.translateMode;
  if (els.translateScope) els.translateScope.value = s.translateScope || 'precise';
  els.autoTranslate.checked = !!s.autoTranslate;
  // 图片翻译的开关
  if (els.imageTranslate) els.imageTranslate.checked = !!s.imageTranslate;
  if (els.imageAuto) els.imageAuto.checked = !!s.imageAuto;
  // 图片译文外观
  if (els.imgShowSource) els.imgShowSource.checked = !!s.imgShowSource;
  if (els.imgTextColor) els.imgTextColor.value = s.imgTextColor || '#ffffff';
  if (els.imgBgColor) els.imgBgColor.value = s.imgBgColor || '#111827';
  if (els.imgFontSize) {
    els.imgFontSize.value = s.imgFontSize || 15;
    if (els.imgFontSizeVal) els.imgFontSizeVal.textContent = (s.imgFontSize || 15) + 'px';
  }
  syncImageHoverRow();
  els.myMemoryEmail.value = s.myMemoryEmail || '';
  els.zhipuApiKey.value = s.zhipuApiKey || '';
  els.zhipuModel.value = s.zhipuModel || 'glm-4-flash';
  els.siliconflowApiKey.value = s.siliconflowApiKey || '';
  // 两个模型下拉各回显自己的 —— 它们已经物理分开了，
  // 不再需要"看图模型借住文字下拉框"那套逻辑。
  els.siliconflowModel.value = s.siliconflowModel || 'tencent/Hunyuan-MT-7B';
  if (els.imageModel) {
    els.imageModel.value = s.imageModel || 'Qwen/Qwen3-VL-30B-A3B-Instruct';
  }
  els.deepseekApiKey.value = s.deepseekApiKey || '';
  els.deepseekModel.value = s.deepseekModel || 'deepseek-flash';
  els.customBaseUrl.value = s.customBaseUrl;
  els.customApiKey.value = s.customApiKey;

  // 模型：已知的两个走下拉，其他走手动输入
  const known = ['deepseek-flash', 'deepseek-v4-pro'];
  if (known.includes(s.customModel)) {
    els.customModel.value = s.customModel;
    els.customModelBox.style.display = 'none';
  } else if (s.customModel) {
    els.customModel.value = '__custom__';
    els.customModelManual.value = s.customModel;
    els.customModelBox.style.display = 'block';
  } else {
    els.customModel.value = 'deepseek-flash';
    els.customModelBox.style.display = 'none';
  }

  syncCustomBox();
}

/** 取当前实际生效的模型名 */
function currentModel() {
  if (els.customModel.value === '__custom__') {
    return els.customModelManual.value.trim();
  }
  return els.customModel.value;
}

/**
 * 判断一个模型名是不是「看图」用的。
 *
 * ★ 还需要它吗？★
 *   2026-10-15 起，两个模型下拉已经**物理分开**了：
 *     · 网站翻译模型（siliconflowModel）—— 只有文字模型
 *     · 漫画看图模型（imageModel）—— 只有看图模型
 *   所以正常情况下不会选错。
 *   这个判断只作**兜底**：万一有人手工改了 storage，
 *   或者以后往某个下拉里误加了混合选项，还能兜一下。
 *
 * 判定依据（硅基流动命名规律，实测确认）：
 *   · 带 VL        → 视觉语言模型，如 Qwen3-VL-8B
 *   · 带 OCR       → 光学字符识别，如 DeepSeek-OCR
 *   · 以 V 结尾    → Vision，如 GLM-4.5V
 */
function isVisionModel(name) {
  const n = String(name || '');
  return /VL[-.]|OCR|\d\.\d+V$|-V$|Vision/i.test(n);
}

function syncModelBox() {
  const isCustom = els.customModel.value === '__custom__';
  els.customModelBox.style.display = isCustom ? 'block' : 'none';
}

function syncCustomBox() {
  const e = els.engine.value;
  els.customBox.classList.toggle('show', e === 'custom');
  // MyMemory 的邮箱设置只在选它时显示
  els.mmEmailRow.style.display = e === 'mymemory' ? 'block' : 'none';
  // 智谱的 Key / 模型只在选它时显示
  els.zhipuBox.style.display = e === 'zhipu' ? 'block' : 'none';
  // 硅基流动的 Key / 模型只在选它时显示
  els.siliconflowBox.style.display = e === 'siliconflow' ? 'block' : 'none';
  // DeepSeek 的 Key / 模型只在选它时显示
  els.deepseekBox.style.display = e === 'deepseek' ? 'block' : 'none';
}

/**
 * 「只翻我选的」模式下：
 *   - 自动翻译勾选框没意义 → 藏起来
 *   - 整页翻译按钮改成提示，避免主人误点
 */
function syncModeUI() {
  const isSelection = els.translateMode.value === 'selection';

  els.autoRow.style.display = isSelection ? 'none' : 'block';

  els.toggle.textContent = isSelection
    ? '选中文字后右键翻译'
    : (isOn ? '关闭翻译' : '开始翻译本页');

  els.toggle.disabled = isSelection;
  els.toggle.style.opacity = isSelection ? '.6' : '1';
  els.toggle.style.cursor = isSelection ? 'default' : 'pointer';
}

async function saveSettings() {
  const payload = {
    engine: els.engine.value,
    targetLang: els.targetLang.value,
    displayMode: els.displayMode.value,
    translateMode: els.translateMode.value,
    // 翻译力度：精翻 / 全翻译（影响页面文字过滤的严格程度）
    translateScope: els.translateScope ? els.translateScope.value : 'precise',
    autoTranslate: els.autoTranslate.checked,
    myMemoryEmail: els.myMemoryEmail.value.trim(),
    zhipuApiKey: els.zhipuApiKey.value.trim(),
    zhipuModel: els.zhipuModel.value,
    siliconflowApiKey: els.siliconflowApiKey.value.trim(),
    // ★ 两个模型各存各的，互不干扰 ★
    //   2026-10-15 改：以前是一个下拉混着两组、靠 JS 分流，
    //   现在改成了两个独立下拉，各写各的键，不会再互相覆盖。
    siliconflowModel: els.siliconflowModel.value,   // 网站翻译模型
    imageModel: els.imageModel ? els.imageModel.value : undefined,
    deepseekApiKey: els.deepseekApiKey.value.trim(),
    deepseekModel: els.deepseekModel.value,
    customBaseUrl: els.customBaseUrl.value.trim(),
    customApiKey: els.customApiKey.value.trim(),
    customModel: currentModel(),
    // 图片翻译
    imageTranslate: els.imageTranslate ? els.imageTranslate.checked : false,
    imageAuto: els.imageAuto ? els.imageAuto.checked : false,
    // 图片译文外观
    imgShowSource: els.imgShowSource ? els.imgShowSource.checked : false,
    imgTextColor: els.imgTextColor ? els.imgTextColor.value : '#ffffff',
    imgBgColor: els.imgBgColor ? els.imgBgColor.value : '#111827',
    imgFontSize: els.imgFontSize ? Number(els.imgFontSize.value) || 15 : 15,
  };

  // imageModel 可能是 undefined（老版本面板没这个元素）。
  // 虽然 JSON 序列化会丢掉 undefined 的键，但那是"隐式行为"，
  // 一旦换成别的存储实现就会出错。显式删掉更稳。
  if (!payload.imageModel) delete payload.imageModel;

  await chrome.storage.local.set(payload);
}

/**
 * 「图片翻译」总开关的子选项显隐。
 *
 * 2026-10-15 改：悬停「译」按钮已删除（被截图翻译碾压），
 * 所以这个函数现在只管「自动翻译」和「译文外观」两行。
 *
 * 函数名保留 syncImageHoverRow 是为了不牵动别处的调用
 * —— 改名要同步改调用点，收益不大、风险不小。
 *
 * 注：截图翻译**不受**这个总开关控制（它是手动的），
 *     所以不在这个函数的管理范围内。
 */
function syncImageHoverRow() {
  if (!els.imageTranslate) return;
  const on = els.imageTranslate.checked;
  // 自动翻译、译文外观这两行跟着图片翻译总开关走。
  // 注：看图模型已经挪进「翻译设置」里，不在这里控制了。
  if (els.imageAutoRow) els.imageAutoRow.style.display = on ? 'block' : 'none';
  if (els.imgLookRow) els.imgLookRow.style.display = on ? 'block' : 'none';
}

// ------------------------------------------------------------------
// 与当前标签页通信
// ------------------------------------------------------------------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(msg) {
  if (currentTabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(currentTabId, msg);
  } catch (err) {
    return { ok: false, error: 'NO_CONTENT_SCRIPT' };
  }
}

function setStatus(html, isWarn) {
  els.status.innerHTML = isWarn
    ? '<span class="warn">' + html + '</span>'
    : html;
}

function refreshToggleLabel() {
  if (els.translateMode.value === 'selection') {
    els.toggle.textContent = '选中文字后右键翻译';
    return;
  }
  els.toggle.textContent = isOn ? '关闭翻译' : '开始翻译本页';
  els.toggle.classList.toggle('off', !isOn);
}

// ------------------------------------------------------------------
// 开关
// ------------------------------------------------------------------
async function doToggle() {
  const res = await sendToTab({ type: 'toggle', on: !isOn });

  if (!res) {
    setStatus('读不到当前标签页', true);
    return;
  }

  if (res.error === 'NO_CONTENT_SCRIPT') {
    setStatus(
      '这个页面上插件还没生效。<br />' +
      '请<b>刷新一下网页</b>再试，或换一个普通网页（浏览器设置页、扩展商店页不支持）。',
      true
    );
    return;
  }

  if (!res.ok) {
    if (res.error === 'SELECTION_ONLY') {
      setStatus(
        '当前是 <b>只翻我选的</b> 模式。<br />' +
        '<span style="color:#888">选中文字 → 右键 → 「用 LiteTranslate 翻译这段」</span>'
      );
      return;
    }
    setStatus('出错：' + (res.error || '未知'), true);
    return;
  }

  isOn = !isOn;
  refreshToggleLabel();

  if (isOn) {
    if (res.already) {
      setStatus('已经在翻译了');
    } else if (res.total === 0) {
      setStatus(
        '这个页面上没找到需要翻译的段落。<br />' +
        '可能它本来就是中文，或者内容还没加载完。'
      );
    } else {
      setStatus(
        '本页共 <b>' + res.total + '</b> 段可翻译内容，<br />' +
        '其中只有 <b>' + res.inView + '</b> 段在屏幕内（现在开始翻）。<br />' +
        '<span style="color:#888">其余 ' + (res.total - res.inView) +
        ' 段等你滚动到才翻 —— 这就是不卡的原因。</span>'
      );
    }
  } else {
    setStatus('已关闭，译文已清除');
  }
}

// ------------------------------------------------------------------
// 测试引擎
// ------------------------------------------------------------------
async function doTest() {
  setStatus('测试中…');
  await saveSettings();

  const overrides = {};
  if (els.engine.value === 'custom') {
    overrides.customBaseUrl = els.customBaseUrl.value.trim();
    overrides.customApiKey = els.customApiKey.value.trim();
    overrides.customModel = currentModel();
  }

  const res = await chrome.runtime.sendMessage({
    type: 'ping-engine',
    overrides,
  });

  if (res && res.ok) {
    setStatus('引擎正常 ✓<br />测试句 “Hello, world.” → <b>' + res.text + '</b>');
  } else {
    setStatus('引擎不通 ✗<br />' + ((res && res.error) || '未知错误'), true);
  }
}

// ------------------------------------------------------------------
// 一键测所有引擎
// ------------------------------------------------------------------
async function doTestAll() {
  setStatus('正在逐个测试…');
  await saveSettings();

  const res = await chrome.runtime.sendMessage({ type: 'ping-all' });

  if (!res || !res.ok || !res.results) {
    setStatus('测试失败：' + ((res && res.error) || '未知'), true);
    return;
  }

  const lines = res.results.map((r) => {
    if (r.ok) {
      return '✅ <b>' + r.label + '</b> → ' + escapeHtml(r.text);
    }
    return '❌ <b>' + r.label + '</b> → ' + escapeHtml(r.error || '失败');
  });

  const anyOk = res.results.some((r) => r.ok);
  const tail = anyOk
    ? '<br /><span style="color:#2d7a2d">至少有一个能用，选它就行。</span>'
    : '<br /><span class="warn">全都不能用 —— 试试填自定义 AI 的 Key。</span>';

  setStatus(lines.join('<br />') + tail, !anyOk);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------
// 手动翻译（把漏翻的内容贴进来翻）
//
// 为什么需要它？
//   自动识别永远会漏 —— 页面结构千奇百怪，不可能 100% 命中。
//   所以给主人留一个"兜底入口"：哪里没翻，贴进来就能翻。
// ------------------------------------------------------------------
async function doManualTranslate() {
  const text = els.manualIn.value.trim();

  if (!text) {
    els.manualOut.textContent = '先粘贴要翻译的内容';
    els.manualOut.classList.add('show');
    return;
  }

  els.manualOut.textContent = '翻译中…';
  els.manualOut.classList.add('show');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'translate',
      text: text,
    });

    if (res && res.ok) {
      els.manualOut.textContent = res.text || '（没有返回内容）';
    } else {
      els.manualOut.textContent =
        '翻译失败：' + ((res && res.error) || '未知错误');
    }
  } catch (err) {
    els.manualOut.textContent = '翻译失败：' + (err.message || String(err));
  }
}

async function doManualCopy() {
  const text = els.manualOut.textContent || '';
  if (!text || text === '翻译中…') {
    setStatus('还没有可复制的结果');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus('译文已复制到剪贴板');
  } catch (err) {
    // 剪贴板不可用时退化为选中
    const range = document.createRange();
    range.selectNodeContents(els.manualOut);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    setStatus('复制失败，已帮主人选中，按 Ctrl+C 复制');
  }
}

// ------------------------------------------------------------------
// 折叠区块
//
// 主人反馈"收不起来" —— 设置项一多，面板就长得没边。
// 所以把不常用的（设置、快捷键、诊断）折起来，默认收起。
// 展开状态记在 storage 里，下次打开还是原样。
// ------------------------------------------------------------------
async function initFolds() {
  const saved = await chrome.storage.local.get({ foldOpen: {} });
  const open = saved.foldOpen || {};

  document.querySelectorAll('.fold-head').forEach((head) => {
    const id = head.dataset.fold;
    const box = document.getElementById(id);
    if (!box) return;

    if (open[id]) box.classList.add('open');

    head.addEventListener('click', async () => {
      box.classList.toggle('open');
      const state = await chrome.storage.local.get({ foldOpen: {} });
      const cur = state.foldOpen || {};
      cur[id] = box.classList.contains('open');
      await chrome.storage.local.set({ foldOpen: cur });
    });
  });
}

// ------------------------------------------------------------------
// 外观设置（双语对照 / 替换原文 —— 两套独立）
//
// 设计要点：全部走 CSS 变量传给 content.js，
// 所以主人拖动滑块时，已经翻好的页面会【立刻】变样，
// 不需要重新翻译一遍。
// ------------------------------------------------------------------

// 双语对照的默认值（主人选定）
const LOOK_DEFAULTS = {
  textColor: '#FF3705',
  bgColor: '#FAFCFF',
  underlineColor: '#0B5FA5',
  fontMode: 'scale',
  fontScale: 1,
  fontSize: 16,
};

// 替换原文的默认值：完全跟随原文，不加装饰
const REPLACE_DEFAULTS = {
  replaceTextColor: 'inherit',   // inherit = 跟随原文颜色
  replaceUnderline: 'none',      // none   = 不加波浪线
  replaceFontMode: 'scale',
  replaceFontScale: 1,
  replaceFontSize: 16,
};

/** 当前面板上的完整外观值（两套） */
function currentAppearance() {
  const fm = document.querySelector('input[name="fontMode"]:checked');
  const rfm = document.querySelector('input[name="replaceFontMode"]:checked');

  return {
    // —— 双语对照 ——
    textColor: els.textColor.value,
    bgColor: els.bgColor.value,
    underlineColor: els.underlineColor.value,
    fontMode: fm ? fm.value : 'scale',
    fontScale: Number(els.fontScale.value) || 1,
    fontSize: Number(els.fontSize.value) || 16,

    // —— 替换原文（独立） ——
    replaceTextColor: els.replaceUseColor.checked
      ? els.replaceTextColor.value
      : 'inherit',
    replaceUnderline: els.replaceUseUnderline.checked
      ? els.replaceTextColor.value
      : 'none',
    replaceFontMode: rfm ? rfm.value : 'scale',
    replaceFontScale: Number(els.replaceFontScale.value) || 1,
    replaceFontSize: Number(els.replaceFontSize.value) || 16,
  };
}

/**
 * 读图片 → 压缩 → 按不透明度画到 canvas → 导出 data URL。
 *
 * 为什么要压？
 *   chrome.storage.local 单条约 8MB（有 unlimitedStorage 会宽松些），
 *   但把几 MB 的原图塞进去、每次翻译都注入 CSS，会明显变慢。
 *   所以这里统一缩到最长边 800px，并按用户设定的不透明度预先合成。
 *
 * 为什么要预合成不透明度？
 *   CSS 的 background-image 没有"不透明度"这个属性（opacity 会连文字一起透明）。
 *   所以最稳的做法：先在 canvas 上把图按 alpha 画淡，再导出成 data URL。
 */
function processBgImage(file, opacity) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这不是有效的图片'));
      img.onload = () => {
        const MAX = 800;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }

        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
        ctx.drawImage(img, 0, 0, w, h);

        // 用 webp 更小；浏览器不支持时自动回退 png
        let url;
        try {
          url = cv.toDataURL('image/webp', 0.85);
          if (!url.startsWith('data:image/webp')) {
            url = cv.toDataURL('image/png');
          }
        } catch (e) {
          url = cv.toDataURL('image/png');
        }
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 更新两个预览块（所见即所得） */
function updatePreview() {
  const a = currentAppearance();

  // ---- 对照模式预览 ----
  const p1 = els.lookPreview;
  p1.style.borderLeft = '3px solid ' + a.textColor;
  p1.style.backgroundColor = a.bgColor;
  p1.style.backgroundImage = 'none';
  p1.style.textShadow = 'none';
  p1.style.color = a.textColor;
  p1.style.textDecoration = 'underline wavy ' +
    (a.underlineColor || a.textColor);
  p1.style.textDecorationThickness = '1px';
  p1.style.textUnderlineOffset = '3px';
  p1.style.fontSize = a.fontMode === 'fixed'
    ? a.fontSize + 'px'
    : (12 * a.fontScale).toFixed(1) + 'px';

  els.fontScaleVal.textContent = Math.round(a.fontScale * 100) + '%';
  els.fontSizeVal.textContent = a.fontSize + 'px';
  els.scaleBox.style.display = a.fontMode === 'fixed' ? 'none' : 'block';
  els.fixedBox.style.display = a.fontMode === 'fixed' ? 'block' : 'none';

  // ---- 替换模式预览 ----
  const p2 = els.replacePreview;
  const rColor = a.replaceTextColor === 'inherit'
    ? 'inherit'
    : a.replaceTextColor;
  p2.style.color = rColor;
  p2.style.textDecoration = a.replaceUnderline === 'none'
    ? 'none'
    : 'underline wavy ' + a.replaceUnderline;
  p2.style.textDecorationThickness = '1px';
  p2.style.textUnderlineOffset = '3px';
  p2.style.fontSize = a.replaceFontMode === 'fixed'
    ? a.replaceFontSize + 'px'
    : (12 * a.replaceFontScale).toFixed(1) + 'px';

  els.replaceFontScaleVal.textContent =
    Math.round(a.replaceFontScale * 100) + '%';
  els.replaceFontSizeVal.textContent = a.replaceFontSize + 'px';
  els.rScaleBox.style.display =
    a.replaceFontMode === 'fixed' ? 'none' : 'block';
  els.rFixedBox.style.display =
    a.replaceFontMode === 'fixed' ? 'block' : 'none';

  // 只在勾了"单独上色"时才显示颜色选择器
  els.replaceColorRow.style.display =
    els.replaceUseColor.checked ? 'block' : 'none';
}

/** 保存外观，并推给当前页面 */
async function applyAppearanceToTab(silent) {
  const a = currentAppearance();
  await chrome.storage.local.set(a);
  updatePreview();

  const r = await sendToTab({ type: 'set-appearance', appearance: a });
  if (!silent) {
    if (r && r.ok) {
      setStatus('外观已更新（页面立刻生效，不用重新翻译）');
    } else {
      setStatus('外观已保存，但当前页面还没加载插件 —— 刷新后生效');
    }
  }
}

async function loadAppearance() {
  const a = await chrome.storage.local.get(
    Object.assign({}, LOOK_DEFAULTS, REPLACE_DEFAULTS)
  );

  // 双语对照
  els.textColor.value = a.textColor || LOOK_DEFAULTS.textColor;
  els.bgColor.value = a.bgColor || LOOK_DEFAULTS.bgColor;
  els.underlineColor.value = a.underlineColor || LOOK_DEFAULTS.underlineColor;
  els.fontScale.value = a.fontScale || 1;
  els.fontSize.value = a.fontSize || 16;
  const fm = document.querySelector(
    'input[name="fontMode"][value="' + (a.fontMode || 'scale') + '"]'
  );
  if (fm) fm.checked = true;

  // 替换原文
  const useColor = a.replaceTextColor && a.replaceTextColor !== 'inherit';
  els.replaceUseColor.checked = !!useColor;
  els.replaceTextColor.value = useColor
    ? a.replaceTextColor
    : LOOK_DEFAULTS.textColor;
  els.replaceUseUnderline.checked =
    !!(a.replaceUnderline && a.replaceUnderline !== 'none');
  els.replaceFontScale.value = a.replaceFontScale || 1;
  els.replaceFontSize.value = a.replaceFontSize || 16;
  const rfm = document.querySelector(
    'input[name="replaceFontMode"][value="' +
    (a.replaceFontMode || 'scale') + '"]'
  );
  if (rfm) rfm.checked = true;

  updatePreview();
}

/** 绑定外观区的所有交互 */
function bindAppearanceEvents() {
  // ---------- 双语对照 ----------
  for (const key of ['textColor', 'bgColor', 'underlineColor']) {
    els[key].addEventListener('input', updatePreview);
    els[key].addEventListener('change', () => applyAppearanceToTab(false));
  }

  els.fontScale.addEventListener('input', updatePreview);
  els.fontScale.addEventListener('change', () => applyAppearanceToTab(false));
  els.fontSize.addEventListener('input', updatePreview);
  els.fontSize.addEventListener('change', () => applyAppearanceToTab(false));

  document.querySelectorAll('input[name="fontMode"]').forEach((r) => {
    r.addEventListener('change', () => applyAppearanceToTab(false));
  });

  els.textColorReset.addEventListener('click', () => {
    els.textColor.value = LOOK_DEFAULTS.textColor;
    applyAppearanceToTab(false);
  });
  els.bgColorReset.addEventListener('click', () => {
    els.bgColor.value = LOOK_DEFAULTS.bgColor;
    applyAppearanceToTab(false);
  });
  els.underlineReset.addEventListener('click', () => {
    els.underlineColor.value = els.textColor.value;
    applyAppearanceToTab(false);
  });

  els.lookReset.addEventListener('click', async () => {
    els.textColor.value = LOOK_DEFAULTS.textColor;
    els.bgColor.value = LOOK_DEFAULTS.bgColor;
    els.underlineColor.value = LOOK_DEFAULTS.underlineColor;
    els.fontScale.value = 1;
    els.fontSize.value = 16;
    const r = document.querySelector('input[name="fontMode"][value="scale"]');
    if (r) r.checked = true;
    await chrome.storage.local.set(Object.assign({}, LOOK_DEFAULTS));
    await applyAppearanceToTab(true);
    setStatus('双语对照外观已恢复默认');
  });

  // ---------- 替换原文（独立） ----------
  els.replaceUseColor.addEventListener('change', () => {
    updatePreview();
    applyAppearanceToTab(false);
  });
  els.replaceTextColor.addEventListener('input', updatePreview);
  els.replaceTextColor.addEventListener('change', () =>
    applyAppearanceToTab(false));

  els.replaceUseUnderline.addEventListener('change', () =>
    applyAppearanceToTab(false));

  els.replaceFontScale.addEventListener('input', updatePreview);
  els.replaceFontScale.addEventListener('change', () =>
    applyAppearanceToTab(false));
  els.replaceFontSize.addEventListener('input', updatePreview);
  els.replaceFontSize.addEventListener('change', () =>
    applyAppearanceToTab(false));

  document.querySelectorAll('input[name="replaceFontMode"]').forEach((r) => {
    r.addEventListener('change', () => applyAppearanceToTab(false));
  });

  els.replaceColorReset.addEventListener('click', () => {
    els.replaceUseColor.checked = false;
    applyAppearanceToTab(false);
  });

  els.replaceReset.addEventListener('click', async () => {
    els.replaceUseColor.checked = false;
    els.replaceUseUnderline.checked = false;
    els.replaceTextColor.value = LOOK_DEFAULTS.textColor;
    els.replaceFontScale.value = 1;
    els.replaceFontSize.value = 16;
    const r = document.querySelector(
      'input[name="replaceFontMode"][value="scale"]'
    );
    if (r) r.checked = true;
    await chrome.storage.local.set(Object.assign({}, REPLACE_DEFAULTS));
    await applyAppearanceToTab(true);
    setStatus('替换原文外观已恢复默认（跟随原文）');
  });
}

// ------------------------------------------------------------------
// 面板自身的外观（插件界面）
//
// ★ 和"译文外观"是两回事：
//     译文外观  → 影响网页上插入的译文
//     面板外观  → 只影响这个弹出面板本身
//
// 不透明度的处理方式：
//   面板不需要预合成，直接用「一层半透明白纱」盖在图上
//   （--pn-veil），字就清楚了。这样拖动滑块能实时看到效果。
// ------------------------------------------------------------------

const PANEL_DEFAULTS = {
  panelSkin: 'minimal',     // 界面皮肤：minimal 极简白 / dark 深色科技 / soft 圆润可爱
  panelBg: '#ffffff',
  panelImage: '',
  panelImageSize: 'cover',
  panelImageRepeat: 'no-repeat',
  panelVeil: 0.72,
  panelText: '#222222',
};

/**
 * 应用界面皮肤。
 *
 * ★ 皮肤是怎么起作用的？★
 *   三套皮肤的 CSS 都写在 popup.html 里，用 body.skin-xxx 前缀隔离。
 *   这里只负责**把 body 上的类换掉**，CSS 自己就生效了。
 *
 * ★ 跟自定义颜色怎么共存？★
 *   自定义颜色是内联写在 <html> 上的 CSS 变量，
 *   内联优先级高于皮肤里的定义 → 用户设的颜色永远赢。
 *   所以「换皮肤」不会把用户调好的颜色冲掉。
 */
function applyPanelSkin(name) {
  const valid = ['minimal', 'dark', 'soft'];
  const skin = valid.indexOf(name) >= 0 ? name : 'minimal';
  const b = document.body;
  valid.forEach((s) => b.classList.remove('skin-' + s));
  b.classList.add('skin-' + skin);
  return skin;
}

/** 把面板外观写到 CSS 变量上 */
function applyPanelAppearance(p) {
  const root = document.documentElement;

  // 先应用皮肤（换 body 的类）
  applyPanelSkin(p.panelSkin);

  // 再应用自定义颜色
  //   ★ 注意：这里只在用户真的改过颜色时才写内联变量 ★
  //     否则会把皮肤自带的配色冲掉 —— 那样深色皮肤就永远是白底
  //     （预览页第一版就踩过这个坑）。
  //   判断依据：颜色跟 PANEL_DEFAULTS 不一样，才认为用户改过。
  if (p.panelBg && p.panelBg !== PANEL_DEFAULTS.panelBg) {
    root.style.setProperty('--pn-bg', p.panelBg);
    root.style.setProperty('--pn-card', p.panelBg);
  } else {
    root.style.removeProperty('--pn-bg');
    root.style.removeProperty('--pn-card');
  }

  if (p.panelText && p.panelText !== PANEL_DEFAULTS.panelText) {
    root.style.setProperty('--pn-text', p.panelText);
  } else {
    root.style.removeProperty('--pn-text');
  }

  if (p.panelImage) {
    root.style.setProperty('--pn-image', 'url("' + p.panelImage + '")');
    root.style.setProperty('--pn-size', p.panelImageSize || 'cover');
    root.style.setProperty('--pn-repeat', p.panelImageRepeat || 'no-repeat');
    root.style.setProperty('--pn-veil', String(
      p.panelVeil === undefined ? 0.72 : p.panelVeil
    ));
    document.body.classList.add('pn-has-image');
  } else {
    root.style.removeProperty('--pn-image');
    root.style.removeProperty('--pn-size');
    root.style.removeProperty('--pn-repeat');
    document.body.classList.remove('pn-has-image');
  }
}

/** 读面板外观设置并应用 */
async function loadPanelAppearance() {
  const p = await chrome.storage.local.get(PANEL_DEFAULTS);
  // 皮肤下拉框回显
  if (els.panelSkin) {
    els.panelSkin.value = p.panelSkin || PANEL_DEFAULTS.panelSkin;
  }
  els.panelBg.value = p.panelBg || PANEL_DEFAULTS.panelBg;
  els.panelText.value = p.panelText || PANEL_DEFAULTS.panelText;
  els.panelVeil.value = p.panelVeil === undefined ? 0.72 : p.panelVeil;
  els.panelVeilVal.textContent =
    Math.round((p.panelVeil === undefined ? 0.72 : p.panelVeil) * 100) + '%';

  els.__panelImage = p.panelImage || '';
  if (p.panelImage) {
    els.panelImageOpts.style.display = 'block';
    let fitVal = 'cover';
    if (p.panelImageRepeat === 'repeat') fitVal = 'repeat';
    else if (p.panelImageSize === 'contain') fitVal = 'contain';
    const fr = document.querySelector(
      'input[name="panelFit"][value="' + fitVal + '"]'
    );
    if (fr) fr.checked = true;
  }

  applyPanelAppearance(p);
  return p;
}

/** 收集面板外观的当前值 */
function currentPanelAppearance() {
  const fit = document.querySelector('input[name="panelFit"]:checked');
  let size = 'cover';
  let repeat = 'no-repeat';
  if (fit) {
    if (fit.value === 'contain') size = 'contain';
    if (fit.value === 'repeat') { size = 'auto'; repeat = 'repeat'; }
  }
  return {
    panelSkin: els.panelSkin ? els.panelSkin.value : 'minimal',
    panelBg: els.panelBg.value,
    panelImage: els.__panelImage || '',
    panelImageSize: size,
    panelImageRepeat: repeat,
    panelVeil: Number(els.panelVeil.value) || 0,
    panelText: els.panelText.value,
  };
}

/** 保存并立刻套用（面板自身的样式，改完马上能看到） */
async function savePanelAppearance(silent) {
  const p = currentPanelAppearance();
  await chrome.storage.local.set(p);
  applyPanelAppearance(p);
  if (!silent) setStatus('面板外观已更新');
}

/** 选中了面板背景图 */
async function onPanelImagePicked() {
  const file = els.panelImageFile.files && els.panelImageFile.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    setStatus('请选择图片文件（jpg / png / webp）', true);
    return;
  }

  setStatus('正在处理图片…');
  try {
    // 面板不需要压得太狠：白纱盖着，细节无所谓，压到 600px 足够
    const dataUrl = await processBgImage(file, 1);
    els.__panelImage = dataUrl;
    els.panelImageOpts.style.display = 'block';
    await savePanelAppearance(true);
    setStatus('面板背景已应用（约 ' +
      Math.round(dataUrl.length / 1024) + ' KB）');
  } catch (err) {
    setStatus('图片处理失败：' + (err.message || err), true);
  }
}

/** 清除面板背景图 */
async function onPanelImageClear() {
  els.__panelImage = '';
  els.panelImageFile.value = '';
  els.panelImageOpts.style.display = 'none';
  await savePanelAppearance(true);
  setStatus('面板背景已清除');
}

/** 绑定面板外观区的交互 */
function bindPanelEvents() {
  // 界面皮肤：换一下就立刻生效（不用重启面板）
  if (els.panelSkin) {
    els.panelSkin.addEventListener('change', async () => {
      const name = els.panelSkin.value;
      await savePanelAppearance(true);
      const label = name === 'dark' ? '深色科技'
        : name === 'soft' ? '圆润可爱' : '极简白';
      setStatus('界面皮肤已换成 <b>' + label + '</b>');
    });
  }

  els.panelBg.addEventListener('input', () => savePanelAppearance(true));
  els.panelBg.addEventListener('change', () => savePanelAppearance(false));

  els.panelText.addEventListener('input', () => savePanelAppearance(true));
  els.panelText.addEventListener('change', () => savePanelAppearance(false));

  // 白纱浓度：实时看效果
  els.panelVeil.addEventListener('input', () => {
    els.panelVeilVal.textContent =
      Math.round(Number(els.panelVeil.value) * 100) + '%';
    savePanelAppearance(true);
  });
  els.panelVeil.addEventListener('change', () => savePanelAppearance(false));

  els.panelImageFile.addEventListener('change', onPanelImagePicked);
  els.panelImageClear.addEventListener('click', onPanelImageClear);

  document.querySelectorAll('input[name="panelFit"]').forEach((r) => {
    r.addEventListener('change', () => savePanelAppearance(false));
  });

  els.panelBgReset.addEventListener('click', async () => {
    els.panelBg.value = PANEL_DEFAULTS.panelBg;
    await savePanelAppearance(false);
  });
  els.panelTextReset.addEventListener('click', async () => {
    els.panelText.value = PANEL_DEFAULTS.panelText;
    await savePanelAppearance(false);
  });
  els.panelReset.addEventListener('click', async () => {
    els.panelBg.value = PANEL_DEFAULTS.panelBg;
    els.panelText.value = PANEL_DEFAULTS.panelText;
    els.panelVeil.value = PANEL_DEFAULTS.panelVeil;
    els.panelVeilVal.textContent = '72%';
    els.__panelImage = '';
    els.panelImageFile.value = '';
    els.panelImageOpts.style.display = 'none';
    const fr = document.querySelector('input[name="panelFit"][value="cover"]');
    if (fr) fr.checked = true;
    await chrome.storage.local.set(Object.assign({}, PANEL_DEFAULTS));
    applyPanelAppearance(PANEL_DEFAULTS);
    setStatus('面板外观已恢复默认');
  });
}

// ------------------------------------------------------------------
// 左下角作者入口：打赏 + B站名片
//
// 设计说明：
//   · 两张图都放在 assets/ 目录，用相对路径引用（popup 是扩展自己的
//     页面，不需要 web_accessible_resources）
//   · 点按钮 → 弹窗显示大图；点遮罩 / 关闭按钮 / Esc 都能关
//   · 打赏码不压缩，保证手机能扫出来
// ------------------------------------------------------------------
const AUTHOR_IMAGES = {
  donate: 'assets/donate-card.png',
  bili: 'assets/bili-card.png',
};

function openAuthorModal(which) {
  const modal = $('authorModal');
  const img = $('amImg');
  if (!modal || !img || !AUTHOR_IMAGES[which]) return;
  img.src = AUTHOR_IMAGES[which];
  img.alt = which === 'donate' ? '打赏作者' : '作者的 B 站';
  modal.classList.remove('am-hidden');
}

function closeAuthorModal() {
  const modal = $('authorModal');
  if (modal) modal.classList.add('am-hidden');
}

function bindAuthorDock() {
  const btnDonate = $('btnDonate');
  const btnBili = $('btnBili');
  const modal = $('authorModal');
  const closeBtn = $('amClose');
  if (!btnDonate || !btnBili || !modal) return;

  btnDonate.addEventListener('click', function () { openAuthorModal('donate'); });
  btnBili.addEventListener('click', function () { openAuthorModal('bili'); });
  if (closeBtn) closeBtn.addEventListener('click', closeAuthorModal);

  // 点遮罩关闭
  modal.addEventListener('click', function (e) {
    if (e.target && e.target.dataset && e.target.dataset.amClose === '1') {
      closeAuthorModal();
    }
  });

  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAuthorModal();
  });
}

/**
 * 功能介绍弹窗（2026-10-17 新增）。
 *
 * ★ 为什么用弹窗，而不是在「设」里往下展开？★
 *   介绍内容有 200 多行，往下展开会把整个「设」页拉得极长，
 *   用户滑半天才能找到真正的设置项。弹窗有固定高度、内部滚动，
 *   看完一关就回到原处，不打断操作。
 *   交互照「赏」那个弹窗来：点遮罩关、点 × 关、Esc 也关。
 */
/**
 * 「⚙️ 翻译设置」弹窗（2026-10-17 新增）。
 *
 * ★ 为什么要改成弹窗？★
 *   设置项很多（6 种引擎，每种一套 Key + 模型，还有大段说明）。
 *   以前是折叠区往下展开，一展开就把整个面板撑得很长，
 *   跟下面的「显示方式」「翻译力度」挤在一起看不清。
 *   弹窗有独立滚动区、内容居中，改完点保存就关，干净得多。
 *
 * ★ 为什么要单独的保存按钮？★
 *   设置项多，用户可能只改其中一两项就想关掉。
 *   有个明确的「保存设置」按钮，心里有底 —— 点了才算数。
 *   保存后自动关闭弹窗，给个"已保存"的反馈。
 */
function openSettingsModal() {
  const modal = $('settingsModal');
  if (!modal) return;
  modal.classList.remove('sm-hidden');
  // 每次打开回到顶部，别让人接着上次的滚动位置看
  const body = modal.querySelector('.sm-body');
  if (body) body.scrollTop = 0;
}

function closeSettingsModal() {
  const modal = $('settingsModal');
  if (modal) modal.classList.add('sm-hidden');
}

function bindSettingsModal() {
  const modal = $('settingsModal');
  if (!modal) return;

  const openBtn = $('settingsOpen');
  const closeBtn = $('smClose');
  const saveBtn = $('smSave');

  if (openBtn) openBtn.addEventListener('click', openSettingsModal);
  if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

  // 保存：调现成的 saveSettings()，然后关窗 + 给反馈
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true;
      saveBtn.textContent = '正在保存…';
      try {
        await saveSettings();
        saveBtn.textContent = '✓ 已保存';
        setStatus('翻译设置已保存');
        // 留一小会儿让用户看到"已保存"，再关
        setTimeout(function () {
          closeSettingsModal();
          saveBtn.disabled = false;
          saveBtn.textContent = '保存设置';
        }, 550);
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存设置';
        setStatus('保存失败：' + e.message, true);
      }
    });
  }

  // 点遮罩关闭
  modal.addEventListener('click', function (e) {
    if (e.target && e.target.dataset && e.target.dataset.smClose === '1') {
      closeSettingsModal();
    }
  });

  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSettingsModal();
  });
}

/**
 * 打开功能介绍的**独立窗口**。
 *
 * ★ 2026-10-17 改：从"面板内弹窗"改成"独立小窗" ★
 *   主人问「弹窗可以离开插件在屏幕中间吗」——
 *   面板只有 320px 宽，长内容挤着读很难受。
 *   用 chrome.windows.create 开一个独立窗口，浏览器会放在屏幕中央，
 *   也能专心读，不用跟设置项抢地方。
 *
 * ★ 为什么不用 chrome.tabs.create？★
 *   标签页会占满整屏，还挤进主浏览窗口的标签栏里。
 *   这个是"看一下就关"的东西，用独立小窗（type: 'popup'）更合适，
 *   关掉也不影响原来的网页。
 *
 * ★ 尺寸怎么定的？★
 *   620×760：比面板宽一倍多，正文一行不会太长；
 *   高度留出顶栏和滚动条，1366×768 的笔记本屏幕也放得下。
 */
function openGuideWindow() {
  const url = chrome.runtime.getURL('guide.html');

  chrome.windows.create(
    {
      url: url,
      type: 'popup',
      width: 640,
      height: 780,
      // 不写 left/top —— 交给浏览器居中，它知道当前屏幕多大
      focused: true,
    },
    function (win) {
      // 万一创建失败（浏览器限制），退回到面板内弹窗，别让按钮点了没反应
      if (chrome.runtime.lastError || !win) {
        const modal = $('guideModal');
        if (modal) modal.classList.remove('gm-hidden');
      }
    }
  );
}

function closeGuideModal() {
  const modal = $('guideModal');
  if (modal) modal.classList.add('gm-hidden');
}

/**
 * 绑定「功能介绍」入口。
 *
 * 现在的行为：点它 → 开一个独立的居中窗口（guide.html）。
 * 面板里那个 guideModal 只当**兜底**用 ——
 * 万一 chrome.windows.create 被浏览器拦了，还能在面板里看。
 */
function bindGuideModal() {
  const modal = $('guideModal');
  const openBtn = $('guideOpen');
  const closeBtn = $('gmClose');

  if (openBtn) openBtn.addEventListener('click', openGuideWindow);

  // 下面这些都是兜底弹窗的关闭逻辑（正常路径走独立窗口，用不到）
  if (!modal) return;

  if (closeBtn) closeBtn.addEventListener('click', closeGuideModal);

  // 点遮罩关闭
  modal.addEventListener('click', function (e) {
    if (e.target && e.target.dataset && e.target.dataset.gmClose === '1') {
      closeGuideModal();
    }
  });

  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeGuideModal();
  });
}

/**
 * 面板内的「模式切换」：网站模式 ↔ 漫画模式。
 *
 * ★ 为什么要分模式？★
 *   两套功能完全不相干（翻网页文字 / 翻漫画图），
 *   堆在一页时面板里有 36 个输入框，用户找不到东西。
 *
 * ★ 按钮上写「切到哪」而不是「现在在哪」★
 *   网站模式下按钮显示「漫」——点它就是去漫画模式。
 *   旁边的小字才标注「当前是什么模式」。
 *   这样按钮写什么就是什么，最不容易搞错。
 */
const MODE_KEY = 'panelMode';   // storage 里的键名
let panelMode = 'site';         // 默认：网站模式

function applyPanelMode(mode) {
  panelMode = mode === 'comic' ? 'comic' : 'site';

  const site = document.getElementById('modeSite');
  const comic = document.getElementById('modeComic');
  const btn = document.getElementById('msBtn');
  const note = document.getElementById('msNote');
  if (!site || !comic) return;

  const isComic = panelMode === 'comic';
  site.style.display = isComic ? 'none' : 'block';
  comic.style.display = isComic ? 'block' : 'none';

  // 按钮显示「点了去哪」，小字显示「现在在哪」
  if (btn) btn.textContent = isComic ? '网' : '漫';
  if (note) note.textContent = isComic ? '漫画模式' : '网站模式';

  // 翻译设置的标题跟着模式变 —— 让用户一眼知道"这是哪个模式的设置"
  //   翻译设置里的内容也是靠 body 上的类自动切换显隐的（见 popup.html 的 CSS）
  const st = document.getElementById('foldSettingsTitle');
  const smt = document.getElementById('smTitle');
  const title = isComic ? '⚙️ 翻译设置（漫画）' : '⚙️ 翻译设置（网站）';
  if (st) st.textContent = title;
  // 弹窗里的标题也要同步（2026-10-17 弹窗化后新增）
  if (smt) smt.textContent = title;

  // body 上的类用于给按钮换配色
  document.body.classList.toggle('mode-comic', isComic);
  document.body.classList.toggle('mode-site', !isComic);

  // ★ 通知页面：切换模式，停掉另一边翻译 ★
  //   为什么？网站「整页翻译」和漫画「图片翻译」都调同一个
  //   硅基流动 Key，同时跑会抢额度。content.js 收到后：
  //     → 切漫画：停文字翻译，开图片自动翻译
  //     → 切网站：停图片翻译，恢复文字翻译（如果之前开着）
  sendToTab({ type: 'set-mode', mode: panelMode });
}

async function loadPanelMode() {
  const s = await chrome.storage.local.get({ panelMode: 'site' });
  applyPanelMode(s.panelMode);
}

function bindModeSwitch() {
  const btn = document.getElementById('msBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const next = panelMode === 'comic' ? 'site' : 'comic';
    applyPanelMode(next);
    await chrome.storage.local.set({ [MODE_KEY]: next });
    setStatus(next === 'comic'
      ? '已切到<b>漫画模式</b>（翻图上的文字）'
      : '已切到<b>网站模式</b>（翻网页文字）');
  });
}

/**
 * 设置页：点右下角「设」进入，点 × 返回。
 *
 * ★ 实现方式是「开关一个 body 类」，不搬动任何 HTML ★
 *   给 body 加 `show-settings` 后，CSS 会自动：
 *     · 隐藏主界面（模式容器、翻译设置折叠区、作者入口、分隔线）
 *     · 显示标了 .in-settings 的折叠区
 *   为什么不用"把元素搬进一个容器"？因为那样要动大量 HTML 嵌套，
 *   一不小心就 div 不平衡（我试过一次，把文件改坏了只能回滚）。
 *   用可见性控制，元素原地不动，零风险。
 *
 * ★ 为什么两个模式共用同一个设置页？★
 *   「双语对照的外观」「替换原文的外观」是网站模式专有的，
 *   但「面板外观」「快捷键」「引擎诊断」是通用的。
 *   与其做两套，不如一套全列出来，在专有那两项上打标签
 *   说明「仅网站模式有效」，用户一看就懂。
 */
function openSettings() {
  document.body.classList.add('show-settings');
  window.scrollTo(0, 0);
}

function closeSettings() {
  document.body.classList.remove('show-settings');
  window.scrollTo(0, 0);
}

function bindSettingsPage() {
  const btn = document.getElementById('msSet');
  const close = document.getElementById('spClose');
  if (btn) btn.addEventListener('click', openSettings);
  if (close) close.addEventListener('click', closeSettings);

  // Esc 也能返回（跟大多数面板一致）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('show-settings')) {
      closeSettings();
    }
  });
}

// ------------------------------------------------------------------
// 截图翻译（框选屏幕 → 裁剪 → 发模型 → 页面贴译文）
//
// ★ 为什么这段逻辑不全在 popup 里？★
//   popup 是个会关的页面 —— 用户鼠标一点到网页上准备拖框，
//   popup 立刻被销毁，里面正在跑的 async 代码就断了。
//   所以 popup 只负责「按一下启动」，真正的流程交给
//   后台 Service Worker（它常驻，不会因为 popup 关掉而中断）。
//
//   完整链路：
//     popup 点按钮 → 后台 → 页面进入框选
//     用户拖框     → 页面把坐标给后台
//     后台截屏     → 把整屏图 + 坐标回给页面
//     页面裁剪     → 调视觉模型（复用图片翻译那套）
//     页面贴译文   → 完成
//
// ★ 为什么截屏必须由后台做？★
//   captureVisibleTab 是扩展级 API，页面里（content script）调不了。
//
// ★ 为什么裁剪又回到页面做？★
//   后台 Service Worker 里没有 DOM/canvas，裁不了图。
//   页面有 canvas，所以裁回去做。
// ------------------------------------------------------------------

async function doShotTranslate() {
  // ★ 顺序很重要：必须「等后台确认收到，再关自己」★
  //   曾经写成「sendMessage 之后立刻 window.close()」——
  //   那样 popup 在消息真正发出去之前就被销毁了，
  //   后台根本收不到（表现就是"点了完全没反应"）。
  //   sendMessage 是异步的，要 await。
  //
  //   后台收到后会立刻回 {ok:true, started:true}（不等用户拖框），
  //   所以这里不会卡住。
  let started = false;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'shot-start' });
    started = !!(r && r.ok);
  } catch (e) {
    started = false;
  }

  if (!started) {
    // 后台没接住 —— 这时候还能显示状态（popup 还没关）
    setStatus('截图翻译启动失败，刷新页面后重试', true);
    return;
  }

  // 后台已经把框选模式开起来了，现在关掉 popup（免得挡住要框的地方）
  window.close();
}

// ------------------------------------------------------------------
// 初始化
// ------------------------------------------------------------------
(async function init() {
  await loadSettings();
  await loadAppearance();
  await loadPanelAppearance();
  await initFolds();
  bindAppearanceEvents();
  bindPanelEvents();
  bindAuthorDock();
  bindGuideModal();
  bindSettingsModal();
  bindModeSwitch();
  bindSettingsPage();
  await loadPanelMode();

  const tab = await getActiveTab();
  currentTabId = tab && tab.id;

  // 同步当前页面的翻译状态
  const st = await sendToTab({ type: 'status' });
  isOn = !!(st && st.ok && st.enabled);
  syncModeUI();
  refreshToggleLabel();

  if (isOn && st) {
    setStatus(
      '正在翻译中：已翻 <b>' + st.translated + '</b> 段' +
      (st.pending ? '，进行中 ' + st.pending + ' 段' : '') +
      (st.failed ? '<br /><span class="warn">失败 ' + st.failed + ' 段</span>' : '')
    );
  }

  // 事件
  els.toggle.addEventListener('click', doToggle);
  els.test.addEventListener('click', doTest);
  els.testAll.addEventListener('click', doTestAll);

  // 手动翻译
  els.manualGo.addEventListener('click', doManualTranslate);
  els.manualCopy.addEventListener('click', doManualCopy);

  // Ctrl+Enter 或直接回车（配合 Shift 换行）
  els.manualIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doManualTranslate();
    }
  });

  for (const key of ['engine', 'targetLang', 'displayMode', 'translateMode', 'translateScope', 'customBaseUrl', 'customApiKey', 'zhipuApiKey', 'zhipuModel', 'siliconflowApiKey', 'siliconflowModel', 'deepseekApiKey', 'deepseekModel']) {
    els[key].addEventListener('change', async () => {
      if (key === 'engine') syncCustomBox();
      await saveSettings();

      // 切翻译力度（精翻 ↔ 全翻译）
      //   ★ 为什么要提示重开？★
      //     力度影响的是「哪些文字算值得翻」—— 这个判断在扫描
      //     页面的那一刻就做完了，已经翻过的段落不会因为改设置重来。
      //     所以必须提示用户重新翻一次，否则改了没感觉。
      if (key === 'translateScope') {
        const isFull = els.translateScope.value === 'full';
        setStatus(
          '已切到<b>' + (isFull ? '全翻译' : '精翻') + '</b>。<br />' +
          '<span style="color:#888">' +
          (isFull
            ? '页面上能翻的都翻，包括登录、密码这类短词。'
            : '只翻成段的正文，译文更干净。') +
          '<br />⚠️ 要重新点「开始翻译本页」才会生效（已翻过的不会重来）。</span>'
        );
        return;
      }

      // 切换翻译范围
      if (key === 'translateMode') {
        syncModeUI();
        if (els.translateMode.value === 'selection') {
          // 关掉正在进行的整页翻译
          if (isOn) {
            await sendToTab({ type: 'toggle', on: false });
            isOn = false;
          }
          setStatus(
            '已切换为 <b>只翻我选的</b>。<br />' +
            '<span style="color:#888">选中网页文字 → 右键 → 「用 LiteTranslate 翻译这段」</span>'
          );
        } else {
          setStatus('已切换为 <b>整页翻译</b>');
        }
        return;
      }

      // 改显示方式时，让已翻译的页面立刻切换，不用重新翻
      if (key === 'displayMode') {
        const r = await sendToTab({
          type: 'set-display-mode',
          mode: els.displayMode.value,
        });
        if (r && r.ok) {
          setStatus(
            els.displayMode.value === 'replace'
              ? '已切换为：<b>直接替换原文</b>'
              : '已切换为：<b>双语对照</b>'
          );
          return;
        }
      }
      setStatus('设置已保存');
    });
  }

  // 模型下拉
  els.customModel.addEventListener('change', async () => {
    syncModelBox();
    await saveSettings();
    setStatus('模型已设为：<b>' + (currentModel() || '未填') + '</b>');
  });

  // 手动填的模型名
  els.customModelManual.addEventListener('change', async () => {
    await saveSettings();
    setStatus('模型已设为：<b>' + (currentModel() || '未填') + '</b>');
  });

  // MyMemory 邮箱（提升额度到 10 倍）
  els.myMemoryEmail.addEventListener('change', async () => {
    await saveSettings();
    const v = els.myMemoryEmail.value.trim();
    if (!v) {
      setStatus('已清空邮箱，额度为每天 <b>5,000 字符</b>');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setStatus('邮箱格式看起来不对，额度可能不会提升', true);
    } else {
      setStatus('已保存。额度提升到每天 <b>50,000 字符</b>（10 倍）');
    }
  });

  // 自动翻译开关
  els.autoTranslate.addEventListener('change', async () => {
    await saveSettings();
    if (els.autoTranslate.checked) {
      setStatus(
        '已开启<b>自动翻译</b>。<br />' +
        '<span style="color:#888">之后打开的英文网页会自动翻译（中文网页会跳过）。</span>'
      );
    } else {
      setStatus('已关闭自动翻译');
    }
  });

  // ---------- 网站翻译模型（只管网页文字）----------
  //   2026-10-15 改：以前这里要做"文字/看图"分流，现在两个下拉分开了，
  //   这里只管存自己的值就行。
  if (els.siliconflowModel) {
    els.siliconflowModel.addEventListener('change', async () => {
      await saveSettings();
      setStatus('网站翻译模型已改为 <b>' + els.siliconflowModel.value + '</b>');
    });
  }

  // ---------- 漫画看图模型（只管认图上的字）----------
  if (els.imageModel) {
    els.imageModel.addEventListener('change', async () => {
      await saveSettings();
      setStatus('漫画看图模型已改为 <b>' + els.imageModel.value + '</b>');
    });
  }

  // ---------- 截图翻译按钮 ----------
  const shotBtn = document.getElementById('shotGo');
  if (shotBtn) {
    shotBtn.addEventListener('click', () => doShotTranslate());
  }

  // ---------- 截图翻译自检 ----------
  //   「点了没反应」时点这个，它把每一步的结果直接显示在面板上，
  //   用户不用开 F12 就能把诊断结果复制给开发者。
  const diagBtn = document.getElementById('shotDiag');
  if (diagBtn) {
    diagBtn.addEventListener('click', async () => {
      const out = document.getElementById('shotDiagOut');
      const log = [];
      out.textContent = '正在检查…';

      // ① 扩展版本
      log.push('① 扩展版本：' + chrome.runtime.getManifest().version);

      // ② 能不能拿到当前标签页
      let tab = null;
      try {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = t;
        log.push('② 当前标签页：' + (t ? '有（id=' + t.id + '）' : '拿不到'));
        if (t && t.url) {
          log.push('   URL：' + t.url.slice(0, 60));
        }
      } catch (e) {
        log.push('② 当前标签页：查询失败 ' + e.message);
      }

      // ③ 页面里有没有内容脚本（最关键的一步）
      if (tab && tab.id != null) {
        try {
          const r = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
          log.push('③ 内容脚本：✅ 在（' +
            (r && r.ok ? '已翻 ' + (r.translated || 0) + ' 段' : '有响应') + '）');
        } catch (e) {
          log.push('③ 内容脚本：❌ 不在 —— 这就是没反应的原因！');
          log.push('   → 请在页面上按 Ctrl+R 刷新，再试');
        }
      }

      // ④ 后台 service worker 活不活
      try {
        const r = await chrome.runtime.sendMessage({ type: 'ping-engine', engine: 'mymemory' });
        log.push('④ 后台：' + (r ? '✅ 活着' : '⚠️ 没响应'));
      } catch (e) {
        log.push('④ 后台：⚠️ ' + e.message);
      }

      // ⑤ 图片翻译开关
      try {
        const s = await chrome.storage.local.get({ imageTranslate: false, siliconflowApiKey: '' });
        log.push('⑤ 图片翻译总开关：' + (s.imageTranslate ? '✅ 已开' : 'ℹ️ 没开'));
        log.push('   （截图翻译是手动的，不依赖它；');
        log.push('     但自动/悬停翻图需要它开着）');
        log.push('   硅基流动 Key：' + (s.siliconflowApiKey ? '✅ 已填' : '❌ 没填（这个必须有）'));
      } catch (e) {
        log.push('⑤ 读设置失败：' + e.message);
      }

      // ⑥ 按钮本身可点吗
      if (shotBtn) {
        log.push('⑥ 截图按钮：' +
          (shotBtn.disabled ? '❌ 被禁用了' : '✅ 可点'));
      }

      out.textContent = log.join('\n');
    });
  }

  // ---------- 图片翻译（看图认字）----------
  if (els.imageTranslate) {
    els.imageTranslate.addEventListener('change', async () => {
      await saveSettings();
      syncImageHoverRow();
      if (els.imageTranslate.checked) {
        setStatus(
          '已开启<b>图片翻译</b>。<br />' +
          '<span style="color:#888">' +
          '刷新页面后，滚到哪就翻到哪（也可以右键单张图翻）。</span>'
        );
      } else {
        setStatus('已关闭图片翻译');
      }
    });
  }

  // 注：「鼠标悬停出现按钮」的监听已删除（2026-10-15）——
  //     那个功能被截图翻译碾压，整个删掉了，对应开关也不复存在。

  // ---------- 自动翻译（滚到哪翻到哪）----------
  if (els.imageAuto) {
    els.imageAuto.addEventListener('change', async () => {
      await saveSettings();
      if (els.imageAuto.checked) {
        setStatus(
          '已开启<b>自动翻译图片</b>。<br />' +
          '<span style="color:#888">' +
          '刷新页面后，图片滚进屏幕就会自动翻（一张约 10~30 秒）。</span>'
        );
      } else {
        setStatus('已关闭自动翻译图片');
      }
    });
  }

  // ---------- 图片译文外观 ----------
  if (els.imgShowSource) {
    els.imgShowSource.addEventListener('change', async () => {
      await saveSettings();
      setStatus(els.imgShowSource.checked
        ? '图片译文将显示<b>双语对照</b>（中文 + 原文）'
        : '图片译文只显示<b>中文</b>');
    });
  }
  if (els.imgTextColor) {
    els.imgTextColor.addEventListener('change', async () => {
      await saveSettings();
      setStatus('译文字体颜色已改');
    });
  }
  if (els.imgTextColorReset) {
    els.imgTextColorReset.addEventListener('click', async () => {
      els.imgTextColor.value = '#ffffff';
      await saveSettings();
      setStatus('译文字体颜色已恢复默认（白色）');
    });
  }
  if (els.imgBgColor) {
    els.imgBgColor.addEventListener('change', async () => {
      await saveSettings();
      setStatus('译文底色已改');
    });
  }
  if (els.imgBgColorReset) {
    els.imgBgColorReset.addEventListener('click', async () => {
      els.imgBgColor.value = '#111827';
      await saveSettings();
      setStatus('译文底色已恢复默认（深灰）');
    });
  }
  if (els.imgFontSize) {
    els.imgFontSize.addEventListener('input', () => {
      if (els.imgFontSizeVal) {
        els.imgFontSizeVal.textContent = els.imgFontSize.value + 'px';
      }
    });
    els.imgFontSize.addEventListener('change', async () => {
      await saveSettings();
      setStatus('译文字号已改为 ' + els.imgFontSize.value + 'px');
    });
  }
})();
