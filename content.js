/**
 * LiteTranslate — 内容脚本（核心）
 *
 * ★ 这个文件是整个演示版的灵魂 ★
 *
 * 和沉浸式翻译最大的差别：
 *
 *   1. 只翻译「你看得见的」段落
 *      IntersectionObserver 盯着视口，没滚到的段落一个字都不翻。
 *
 *   2. 给每块译文加 CSS 隔离（contain / content-visibility）
 *      → 插入几百个译文块也不会引发几百次全局重排。
 *
 *   3. 【v0.2 改动】改用「文本节点驱动」而不是「标签白名单驱动」
 *      旧版只认 p/li/h1 这些标签，导致 div/span 里的标题被漏掉。
 *      新版遍历所有文本节点，再向上找到合适的「翻译宿主」。
 *
 *   4. 【v0.2 新增】显示方式可选
 *      - bilingual：双语对照（译文在原文下方）
 *      - replace  ：直接替换原文（隐藏原文，只显示译文）
 *
 * 沉浸式翻译为什么卡？
 *   它对整页 DOM 做文字替换，产生大面积渲染脏区，浏览器合成线程
 *   要序列化整棵图层树，长页面直接拖垮，连 Windows 桌面都掉帧。
 *   （根因见 immersive-translate GitHub Issue #3765）
 */

(() => {
  'use strict';

  // 防止重复注入。
  // 注意：右键菜单在"页面还没有内容脚本"时会补注入一次，
  // 所以这里必须挡住第二次执行，否则监听器会叠加、提示框会弹两遍。
  //
  // ★ 2026-10-16 修 ★
  //   以前这里只重试「翻译选区」，漏了「翻译图片」。
  //   主人的实测场景正是这样：
  //     ① 在 edge://extensions 重载扩展 → 页面里旧脚本失效
  //     ② 右键「翻译这张图」→ 后台发消息失败 → 补注入 content.js
  //     ③ 脚本看到 __liteTranslateLoaded=true → 只重试选区翻译
  //     ④ 图片翻译没人管 → 表现为「点了没反应」
  //   现在把「上次想干什么」记下来，补注入时一并重试。
  if (window.__liteTranslateLoaded) {
    try {
      if (window.__liteTranslatePending === 'image-here') {
        window.__liteTranslateRetryImageHere && window.__liteTranslateRetryImageHere();
      } else {
        window.__liteTranslateRetrySelection && window.__liteTranslateRetrySelection();
      }
    } catch (e) { /* 忽略 */ }
    return;
  }
  window.__liteTranslateLoaded = true;

  // ================================================================
  // 配置
  // ================================================================
  const MIN_HOST_TEXT = 4;        // 宿主元素最少要有这么多字符
  const MIN_NODE_TEXT = 3;        // 文本节点太短的直接跳过（性能）
  const MIN_TRANSLATABLE = 12;    // 值得翻译的最短长度
  const MAX_HOST_TEXT = 2000;     // 宿主太长说明选错容器了，放弃
  const MAX_INLINE_KIDS = 6;      // ★ 行内子元素太多 = 像工具栏，放弃（治乱码）
  const MAX_CONCURRENCY = 3;      // 默认并发（会按引擎下调，见 engineLimit）
  const VISIBLE_MARGIN = '300px'; // 提前 300px 开翻
  const RESCAN_DELAY = 1200;      // SPA 补扫节流
  const AUTO_DELAY = 900;         // 自动翻译的起始延迟（等页面稳定）

  // ----------------------------------------------------------------
  // 行内标签分两类（这是 v0.3 治乱码的关键）
  //
  //   SAFE_INLINE   —— 纯排版用途，文字可以安全并进宿主
  //   RISKY_INLINE  —— 可能是按钮/图标/控件，要逐个检查
  // ----------------------------------------------------------------
  const SAFE_INLINE = new Set([
    'STRONG', 'EM', 'B', 'I', 'U', 'S', 'SMALL', 'MARK', 'ABBR',
    'CITE', 'Q', 'SUB', 'SUP', 'TIME', 'FONT', 'BIG', 'TT',
    'STRIKE', 'INS', 'DEL', 'VAR', 'DFN', 'ACRONYM', 'BDI', 'BDO',
    'RUBY', 'RT', 'RP', 'NOBR',
  ]);

  const RISKY_INLINE = new Set(['A', 'SPAN', 'LABEL', 'OUTPUT', 'DATA', 'BDI']);

  // 名字里带这些词的 class，八成是按钮/徽章，不要并进来
  const CONTROL_CLASS_RE = /(^|[\s_-])(btn|button|icon|badge|chip|tag|pill|label|action|control|toggle|switch|menu|tab)([\s_-]|$)/i;

  // ★ v0.4 关键：识别「人家自己插进去的节点」，绝不能把它们当原文再翻一遍
  const LT_CLASS_RE = /(^|\s)(lt-trans|lt-orig)(\s|$)/;

  // 媒体/嵌入类标签：取文字时直接跳过
  const MEDIA_TAGS = new Set([
    'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG',
    'IFRAME', 'OBJECT', 'EMBED', 'MAP', 'AREA', 'TRACK',
  ]);

  // 「页面框架区」——顶栏/导航/页脚
  // 这些地方的短文字基本都是 UI 标签，翻出来最容易乱，也最没价值
  const CHROME_SELECTOR = 'header, nav, footer, [role="banner"], [role="navigation"], [role="toolbar"], [role="menubar"]';
  const CHROME_MIN_TEXT = 60;   // 框架区里短于这个长度就不翻
  const MAX_FRAG_KIDS = 3;      // 3 个以上控件式兄弟 = 工具栏，不是句子
  const FRAG_MAX_TEXT = 120;    // 配合上面用：短文本才判定为工具栏

  // 遇到这些标签就不单独成段，继续向上找块级宿主
  const INLINE_TAGS = new Set([
    ...SAFE_INLINE, ...RISKY_INLINE,
    'WBR', 'BR', 'IMG', 'PICTURE', 'SOURCE', 'MAP', 'AREA',
  ]);

  // 这些标签内部一律不碰
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS',
    'IFRAME', 'VIDEO', 'AUDIO', 'MATH', 'BUTTON', 'TEMPLATE',
  ]);

  // 这些容器不当作宿主（太大了）
  const NEVER_HOST = new Set([
    'BODY', 'HTML', 'HEAD', 'MAIN', 'ARTICLE', 'SECTION', 'NAV',
    'ASIDE', 'HEADER', 'FOOTER', 'FORM', 'FIELDSET', 'UL', 'OL',
    'TABLE', 'TBODY', 'THEAD', 'TR', 'DL', 'FIGURE', 'DETAILS',
    'DIALOG', 'MENU', 'HTML',
  ]);

  // ================================================================
  // 状态
  // ================================================================
  let enabled = false;
  // 切换模式时，记住「文字翻译原来开没开」，好切回来自动恢复
  let modeSiteWasOn = false;
  let observer = null;
  let pendingCount = 0;
  const queue = [];
  let settings = {
    targetLang: 'zh-CN',
    displayMode: 'bilingual', // bilingual | replace
    // 翻译范围：'precise'（精翻，只翻像正文的段落）
    //          'full'（全翻译，连「登录」「密码」「Sign in」都翻）
    //   ★ 为什么要有这个？★
    //     0 英语水平的人连按钮上的 Sign in 都看不懂，
    //     但精翻会跳过这些短词（那是为了译文干净刻意过滤的）。
    //     两拨人需求冲突，所以做成开关让用户自己选。
    translateScope: 'precise',
  };

  // ================================================================
  // 基础工具
  // ================================================================
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /**
   * 判断文本是否像外语、值得翻译。
   *
   * ★ 2026-10-14 修：按「语言类型」区别对待 ★
   *
   * 背景（主人反馈）：访问韩文漫画站 lezhin.com/ko，整页「已翻 0 段」。
   * 根因实测：原规则要求「连续 4 个以上外文字符」+「外文总数 ≥ 8」。
   *   韩文是【空格分词】语言：'매일 매일 출석 챌린지' 每段只有 2~3 字，
   *   一个「连续 4 个」都凑不出来 → 整句被判定为"不值得翻译"。
   *   日语同样中招：'これはテストです' 假名只有 7 个 < 8 → 被跳过。
   *   只有英文不受影响（单词普遍 ≥4 字母）。
   *
   * 为什么不能一放了之？把阈值统一调低，英文站会开始翻
   *   导航、按钮、代码片段这些不该翻的东西。
   *
   * 所以按语言分两档：
   *   · 空格分词的语言（韩文）—— 单「词」天然很短，阈值必须低
   *   · 拉丁字母（英文）—— 单词本来长，保持严格
   *   · 无空格语言（日文假名）—— 靠总字数判断，阈值也降低
   */
  // 连续 4 个以上：空格分词语言凑不出，所以分两档
  const RE_FOREIGN_STRICT =
    /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]{4,}/g;
  // 连续 2 个以上：给韩文/日文这类短词语言用
  const RE_FOREIGN_LOOSE =
    /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]{2,}/g;
  const RE_FOREIGN_CHAR =
    /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]/g;

  // 韩文音节的起始码位（U+AC00）—— 有它说明这是韩文，走宽松档
  const RE_HANGUL = /[\uAC00-\uD7AF]/;
  // 日文假名（平假名 + 片假名）—— 无空格分词，也走宽松档
  const RE_KANA = /[\u3040-\u30FF]/;

  /**
   * 「这看起来是个标签，不是句子」
   *
   * ★ 2026-10-14 新增，起因是一次真实翻车 ★
   *   把韩文门槛降到 4 之后，韩文站的「标签云」被当成正文翻了：
   *     #{소심남} 있어요. #이있 역 #먹대금 #후회공 #소심녀 #레진툰_명절대첩
   *   这一堆碎片被拼成一段发给模型，模型看不懂要干什么，
   *   就开始自己发挥（输出"**译文：**""**解释：**""**重复原文：**"
   *   和一大段数学定义），页面上出现一个几百字的黑框。
   *
   *   实测结论：光靠「长度」切不干净 ——
   *     碎片 `#소심남` 4 字，而作者名 `자무사탕러브` 6 字，
   *     标签 `레진툰_명절대첩` 8 字，长度区间完全重叠。
   *   所以必须按「特征」判断，不能只按长度。
   *
   * 判定为标签的特征（命中任一即是）：
   *   · 以 # 开头，或 # 号占比很高（话题标签）
   *   · 含下划线且没有空格（分类 ID，如 레진툰_명절대첩）
   *   · 纯数字 / 纯日期（1、7/15）
   *   · 纯大写英文短词（EVENT、NEW）
   *
   * @param {string} text  待判定的文本
   * @param {string} scope 翻译力度：'precise'（精翻）/ 'full'（全翻译）
   *   ★ 为什么用参数传、不直接读 settings？★
   *     这两个函数是**纯判断逻辑**，最好不依赖外部状态 ——
   *     依赖了就没法单独抽出来测（测试已因此报过错：
   *     "ReferenceError: settings is not defined"）。
   *     传参后函数自包含，测试可以直接跑。
   */
  function looksLikeTag(text, scope) {
    const t = text.trim();
    if (!t) return true;

    // ★ 全翻译模式：这里几乎全部放开 ★
    //
    // 为什么？
    //   精翻跳过这些是为了「译文干净」—— 标签、角标翻出来确实乱。
    //   但全翻译面向 0 英语水平用户：他们连登录框都看不懂，
    //   宁可译文密一点，也不能漏掉任何一句他们需要读的话。
    //   实测教训：minLen 之类的门槛把「登录」「密码」也一起滤掉了，
    //   结果最需要翻译的人反而用不了。主人的决定是「全放开」。
    //
    // 仍然不翻的（翻出来没有任何意义，只会浪费额度）：
    //   · 纯数字 / 日期 / 分数：1、7/15、2026-10-14
    //   · 纯符号（没有任何字母）：★★★★★、——、· · ·
    //   · 太短的（1~2 个字）：翻不了，而且角标数量巨大
    if (scope === 'full') {
      // 纯数字 / 日期 / 分数 → 不翻（翻译了也还是数字）
      if (/^[\d\s/.\-:,]+$/.test(t)) return true;
      // 一个字母都没有（纯符号） → 不翻
      if (!/[a-zA-Z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/i.test(t)) return true;
      // 太短（1~2 个字）：翻出来没意义，而且数量巨大（每个角标一个请求）
      if (t.replace(/\s/g, '').length <= 2) return true;
      return false;   // 其余全放行
    }

    // ① 话题标签：以 # 开头，且整体很短
    //    ★ 为什么必须限定「以 # 开头」？★
    //      实测踩坑：区块标题 '취향 발견! #태그 감색'（发现喜好！标签搜索）
    //      中间带一个 # 号，用「只要含 # 就当标签」的写法会把它误杀，
    //      整个区块标题就不翻了。而真正的标签都是 # 开头的。
    if (/^#/.test(t) && t.length <= 20) return true;

    // ② 整串大部分是 #标签（如 "#a #b #c" 这种标签串）
    const hashCount = (t.match(/#/g) || []).length;
    if (hashCount >= 2 && hashCount * 4 >= t.length) return true;

    // ③ 分类 ID：含下划线、且整串没有空格、且不长
    //    例：레진툰_명절대첩
    if (t.indexOf('_') !== -1 && !/\s/.test(t) && t.length <= 24) return true;

    // ④ 纯数字 / 日期 / 分数：1、7/15、2026-10-14
    if (/^[\d\s/.\-:]+$/.test(t)) return true;

    // ⑤ 纯大写英文（≤12 字符）：EVENT、NEW、FREE
    if (t.length <= 12 && /^[A-Z0-9\s!&+\-]+$/.test(t) && /[A-Z]/.test(t)) return true;

    return false;
  }

  /**
   * 判断一段文字值不值得翻。
   *
   * @param {string} text       待判定文本
   * @param {string} targetLang 目标语言
   * @param {string} scope      翻译力度：'precise'（精翻）/ 'full'（全翻译）
   *   —— 用参数传而不读外部 settings，理由同 looksLikeTag。
   */
  function looksTranslatable(text, targetLang, scope) {
    if (!text) return false;

    // 先过「标签特征」这一关 —— 碎片一律不翻（乱码的头号来源）
    // 注：全翻译模式下 looksLikeTag 自己会大幅放宽（只挡纯数字/纯符号）
    if (looksLikeTag(text, scope)) return false;

    // 韩文 / 日文：用宽松阈值
    // ★ 为什么连「最短长度」也要分档？★
    //   韩文/日文信息密度高，同样一句话字符数天然比英文少：
    //     英文 "Baby is born"      → 12 字符
    //     韩文 "베이비가 생겼어요"      →  9 字符
    //     日文 "これはテストです"       →  8 字符
    //   12 这个门槛是按英文定的，对韩日文一律误杀（实测 12 项里错杀 9 项）。
    //
    // ★ 门槛为什么从 4 提到 5？★
    //   降到 4 时翻出一堆 2~4 字的导航碎片（만화/성인/무료），
    //   页面被翻得七零八落。提到 5 能挡掉大部分，且不影响真实句子
    //   （实测内容文本最短 6 字：자무사탕러브）。
    const isShortWordLang = RE_HANGUL.test(text) || RE_KANA.test(text);

    // ★ 全翻译模式：门槛降到最低 ★
    //
    // 为什么？
    //   精翻的 minLen=5/12、minChars=5/8 是为了"只翻像正文的段落"。
    //   可这些门槛把「Sign in」「Login」「Password」「忘记密码」全滤掉了
    //   —— 而这恰恰是 0 英语水平用户最需要看的。
    //
    //   全翻译放到：3 个字符、2 个外文字母就翻。
    //
    //   ★ 两个门槛为什么这么定？★
    //     minLenFull = 3（**总长度**）：挡住 1~2 字符的碎片
    //       —— 单个字母 x、数字 12 都在这关被拦掉。
    //     minCharsFull = 2（**外文字母数**）：不能卡到 3
    //       实测踩坑：韩文话题标签「#태그」总长 3、
    //       但外文字母只有 2 个（태、그），卡 3 就把它滤掉了。
    //       既然总长度那关已经挡住碎片，这里放宽到 2 是安全的。
    //       能覆盖 Login / Email / 로그인 / パスワード / #태그 这些真实场景。
    if (scope === 'full') {
      const minLenFull = 3;    // 总长度至少 3（挡住 x、12 这类碎片）
      const minCharsFull = 2;  // 外文字母至少 2（#태그 这种刚好过关）

      if (text.length < minLenFull) return false;

      // 用「宽松」规则找外文（韩日文那种按 2 字符连续算）
      const foreignFull = text.match(RE_FOREIGN_LOOSE);
      if (!foreignFull) return false;

      const lettersFull = text.match(RE_FOREIGN_CHAR);
      if (!lettersFull || lettersFull.length < minCharsFull) return false;

      // 目标为中文时：本来就是中文的跳过
      //   ★ 这条仍然保留 ★
      //     页面上大量中文（导航、正文）再送去翻译纯属浪费，
      //     而且模型可能把中文"翻"成别的，反而出乱子。
      if (targetLang && targetLang.startsWith('zh')) {
        const cjkFull = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
        const cjkCountFull = cjkFull ? cjkFull.length : 0;
        // 全翻译下阈值也放宽：中文占比超过 90% 才跳过
        //（原来 60% 会把「登录 Login」这种中英混排误杀）
        if (cjkCountFull > lettersFull.length * 9) return false;
      }
      return true;
    }

    const minLen = isShortWordLang ? 5 : MIN_TRANSLATABLE;
    if (text.length < minLen) return false;

    const minRun = isShortWordLang ? 2 : 4;      // 连续几个算"外语"
    const minChars = isShortWordLang ? 5 : 8;    // 外文总数至少几个

    const runRe = isShortWordLang ? RE_FOREIGN_LOOSE : RE_FOREIGN_STRICT;
    const foreign = text.match(runRe);
    if (!foreign) return false;

    const letters = text.match(RE_FOREIGN_CHAR);
    if (!letters || letters.length < minChars) return false;

    // 目标为中文时：本来就是中文的跳过
    if (targetLang && targetLang.startsWith('zh')) {
      const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
      const cjkCount = cjk ? cjk.length : 0;
      if (cjkCount > letters.length * 0.6) return false;
    }
    return true;
  }

  /**
   * 从一个文本节点向上找到「翻译宿主」。
   *
   * 规则：
   *   - 父级是行内标签（a/span/strong…）→ 继续向上
   *   - 遇到第一个非行内标签 → 它就是宿主
   *   - 遇到 SKIP_TAGS 一般放弃，但【内容型按钮】例外
   */
  function findHost(textNode) {
    let el = textNode.parentElement;
    if (!el) return null;

    // 译文块内部的文本，绝不处理
    if (el.closest && el.closest('.lt-trans')) return null;

    let hops = 0;
    while (el && hops < 12) {
      // ★ 自家插的节点，一律不碰
      if (isOwnNode(el)) {
        return null;
      }

      const tag = el.tagName;

      // 跳过标签：先看看是不是「内容型按钮」
      if (SKIP_TAGS.has(tag)) {
        return isContentControl(el) ? el : null;
      }

      if (!INLINE_TAGS.has(tag)) break;
      el = el.parentElement;
      hops++;
    }

    if (!el) return null;
    if (el === document.body || el === document.documentElement) return null;
    if (SKIP_TAGS.has(el.tagName)) return isContentControl(el) ? el : null;
    if (NEVER_HOST.has(el.tagName)) return null;

    return el;
  }

  /**
   * 「内容型控件」判定 —— 这是 v0.4 为了两头兼顾加的。
   *
   * 为什么需要它？
   *   GitHub 的「Create your first code project」这类标题写在 <button>
   *   或 <summary> 里。一刀切跳过按钮 → 这些该翻的就没翻（主人反馈过）。
   *   但全都翻 → 顶栏那些 "Debug" "Agent" "Git" 又会贡献乱码。
   *
   * 折中：里面的文字「像一句人话」才翻。
   *   够长（≥12）+ 有空格分隔的多个词 + 含小写字母（不是全大写缩写）
   */
  function isContentControl(el) {
    const tag = el.tagName;
    const role = el.getAttribute && el.getAttribute('role');
    const isControl =
      tag === 'BUTTON' || tag === 'SUMMARY' ||
      (role && /button|tab|menuitem/i.test(role));
    if (!isControl) return false;

    // 别把「人家插过译文的」再当宿主
    if (el.dataset && el.dataset.ltDone === '1') return false;

    const text = norm(ownTextOf(el));
    if (text.length < MIN_TRANSLATABLE) return false;

    // 必须像一句话：有空格、有词
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 3) return false;

    // 全大写通常是缩写/标签，不是内容
    if (text === text.toUpperCase()) return false;

    // 至少要有小写字母，说明是自然语言
    if (!/[a-z]/.test(text)) return false;

    return true;
  }

  /**
   * 判断一个行内子元素是不是「控件」（按钮、图标、徽章…）。
   *
   * 为什么要判它？
   *   GitHub 顶栏那种「Open new tab (g then p)」的结构，
   *   把好几个控件的文字拼在一起翻译，就会出「g然后p」这种乱码。
   */
  function looksLikeControl(el) {
    const tag = el.tagName;

    // 明确的控件标签
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
        tag === 'TEXTAREA' || tag === 'SVG' || tag === 'LABEL') return true;

    // 带交互角色
    const role = el.getAttribute && el.getAttribute('role');
    if (role && /button|tab|menuitem|switch|checkbox|radio|link|option/i.test(role)) {
      return true;
    }

    // 名字里带 btn/icon/badge/tag 之类的 class
    const cls = (el.className && typeof el.className === 'string') ? el.className : '';
    if (cls && CONTROL_CLASS_RE.test(cls)) return true;

    // 里面装着图标 / 图片
    if (el.querySelector && el.querySelector('svg,img,use,path,picture')) return true;

    // 链接一般也是独立控件（但纯文字的正文链接除外，见下面判断）
    if (tag === 'A') {
      const hasElementChild = el.children && el.children.length > 0;
      // 链接里还嵌着别的元素 → 当控件处理
      if (hasElementChild) return true;
    }

    return false;
  }

  /**
   * 取元素的「直接文本」——
   * 只算自家文本节点 + 安全的行内子元素文字，不含子块级元素的文字。
   *
   * v0.3 改了三点（都是为了治乱码）：
   *   1. RISKY_INLINE 子元素如果是控件 → 整块跳过，文字不进宿主
   *   2. 统计行内子元素数量，太多说明这是工具栏不是段落 → 交给调用方否掉
   *   3. 顺便返回统计信息，供 collectHosts 做二次筛选
   */
  function directText(el) {
    let out = '';
    let inlineKids = 0;
    let riskyKids = 0;
    let controlKids = 0;

    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        out += node.nodeValue;
        continue;
      }
      if (node.nodeType !== 1) continue;

      // ★ 自家插的译文/原文包裹，绝不能算进来（否则会自我复制、越翻越乱）
      if (isOwnNode(node)) continue;

      const tag = node.tagName;

      // 跳过标签、媒体标签：不取文字
      if (SKIP_TAGS.has(tag) || MEDIA_TAGS.has(tag)) continue;
      if (tag === 'BR') { out += ' '; continue; }
      if (!INLINE_TAGS.has(tag)) continue;

      inlineKids++;

      const isControl = looksLikeControl(node);
      if (isControl) controlKids++;

      if (RISKY_INLINE.has(tag)) {
        riskyKids++;
        // 控件里的文字不并进来（这是乱码的主要来源）
        if (isControl) continue;
      }

      // ★ 取文字时也要排除自家译文
      out += ownTextOf(node);
    }

    return {
      text: norm(out),
      inlineKids,
      riskyKids,
      controlKids,
    };
  }

  /** 取一个元素的文字，但排除自家插入的译文/包裹节点 */
  function ownTextOf(el) {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { s += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (isOwnNode(n)) continue;
      if (SKIP_TAGS.has(n.tagName) || MEDIA_TAGS.has(n.tagName)) continue;
      s += ownTextOf(n);
    }
    return s;
  }

  /** 判断元素是否位于页面框架区（顶栏/导航/页脚） */
  function inChromeArea(el) {
    let p = el;
    let hops = 0;
    while (p && hops < 8) {
      if (p.matches && p.matches(CHROME_SELECTOR)) return true;
      p = p.parentElement;
      hops++;
    }
    return false;
  }

  /**
   * ★ v0.4 核心修复：判断一个节点是不是「人家自己插进去的」。
   *
   * 这是主人反馈的乱码真凶 ——
   *   人家插入译文 → 网站变动触发重扫 → directText 把刚插的译文
   *   也算成原文 → 送去做第二次翻译 → 译上加译，出来就是
   *   "gGithen dD" 这类鬼东西。
   *
   * 为了在各种浏览器/元素上都可靠，这里同时检查：
   *   - classList（普通 HTML 元素）
   *   - className 字符串（老式用法）
   *   - className.baseVal（SVG 元素的 className 是对象）
   */
  function isOwnNode(node) {
    if (!node || node.nodeType !== 1) return false;

    // ① classList
    if (node.classList && typeof node.classList.contains === 'function') {
      if (node.classList.contains('lt-trans') || node.classList.contains('lt-orig')) {
        return true;
      }
    }

    // ② className 字符串
    const cls = node.className;
    if (typeof cls === 'string' && cls && LT_CLASS_RE.test(cls)) return true;

    // ③ SVG 的 className 是 SVGAnimatedString
    if (cls && typeof cls === 'object' && typeof cls.baseVal === 'string') {
      if (LT_CLASS_RE.test(cls.baseVal)) return true;
    }

    // ④ 兜底：属性里写着
    if (node.getAttribute) {
      const attr = node.getAttribute('class');
      if (attr && LT_CLASS_RE.test(attr)) return true;
    }

    return false;
  }

  /**
   * 判断这段文字是不是「碎片拼接」——
   * 一堆很短的词用空格连着，典型是工具栏/导航，不是句子。
   *
   * 例："Open g then p Search Ask Git Write code"
   */
  function looksLikeFragmentRun(text) {
    if (text.length > FRAG_MAX_TEXT) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 3) return false;

    // 平均词长很短 → 像按钮标签串
    let shortWords = 0;
    for (const w of words) if (w.length <= 5) shortWords++;
    const ratio = shortWords / words.length;

    // 大部分词都很短，且没有句末标点 → 判定为碎片串
    return ratio > 0.7 && !/[.!?。！？]/.test(text);
  }

  // ================================================================
  // 收集可翻译宿主
  //
  // v0.2 新算法：
  //   遍历所有文本节点（TreeWalker 很快）→ 向上找宿主 → 去重
  //   这样 div / span 里承载的标题也能被抓到。
  // ================================================================
  function collectHosts() {
    const hosts = new Set();

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const v = node.nodeValue;
          if (!v || v.length < MIN_NODE_TEXT) return NodeFilter.FILTER_REJECT;
          if (!/\S/.test(v)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const host = findHost(node);
      if (host) hosts.add(host);
    }

    // 逐个校验，挑出真正值得翻译的
    const result = [];
    for (const el of hosts) {
      if (el.dataset.ltDone === '1' || el.dataset.ltQueued === '1') continue;

      const info = directText(el);
      const text = info.text;

      if (text.length < MIN_HOST_TEXT) continue;

      // 太长 → 选错容器了
      if (text.length > MAX_HOST_TEXT) continue;

      // 框架区（顶栏/导航/页脚）里的短文字 → 跳过，这里最容易乱码
      if (inChromeArea(el) && text.length < CHROME_MIN_TEXT) continue;

      // 碎片拼接（一堆短词）→ 跳过，这是工具栏/导航条
      if (looksLikeFragmentRun(text)) continue;

      // 控件式兄弟太多，且文字不长 → 这是工具栏不是句子
      if (info.controlKids >= MAX_FRAG_KIDS && text.length < FRAG_MAX_TEXT) continue;

      if (!looksTranslatable(text, settings.targetLang, settings.translateScope)) continue;

      // 宿主自身不该包含别的块级宿主（否则会重复翻译）
      if (containsBlockChildWithText(el)) continue;

      result.push(el);
    }
    return result;
  }

  /** 元素里是否还有「带文字的块级子元素」 */
  function containsBlockChildWithText(el) {
    for (const child of el.children) {
      const tag = child.tagName;
      if (SKIP_TAGS.has(tag)) continue;
      if (INLINE_TAGS.has(tag)) continue;
      if (norm(child.textContent).length >= MIN_NODE_TEXT) return true;
    }
    return false;
  }

  // ================================================================
  // 翻译队列（并发上限）
  // ================================================================
  function enqueue(el) {
    if (el.dataset.ltQueued === '1' || el.dataset.ltDone === '1') return;
    el.dataset.ltQueued = '1';
    queue.push(el);
    pump();
  }

  /**
   * 当前引擎允许的并发数。
   *
   * ★ 这是「智谱好慢」的修复点 ★
   *   智谱免费模型只有 1 并发（官方硬限制）。旧版固定用 3 并发去撞，
   *   两个请求会被拒，表现就是"一句一句慢慢蹦"。
   *   现在按引擎调整，智谱就稳稳地一个一个翻。
   */
  function engineLimit() {
    const e = settings.engine || 'mymemory';
    if (e === 'zhipu') return 1;         // 免费模型 1 并发（官方硬限制）
    if (e === 'siliconflow') return 5;   // L0 有 1000 RPM，可以拉满
    if (e === 'deepseek') return 3;      // 付费但便宜
    if (e === 'mymemory') return 2;      // 免费服务，别打太猛
    return MAX_CONCURRENCY;              // 其他（含自定义/谷歌）用 3
  }

  function pump() {
    const limit = engineLimit();
    while (pendingCount < limit && queue.length > 0) {
      const el = queue.shift();
      if (!el || !el.isConnected) continue;
      if (!enabled) { el.dataset.ltQueued = '0'; continue; }

      pendingCount++;
      translateElement(el).finally(() => {
        pendingCount--;
        pump();
      });
    }
  }

  async function translateElement(el) {
    const original = norm(el.dataset.ltOriginal || directText(el).text);
    if (!original) {
      el.dataset.ltQueued = '0';
      return;
    }
    el.dataset.ltOriginal = original;

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'translate',
        text: original,
      });
    } catch (err) {
      el.dataset.ltQueued = '0';
      return;
    }

    if (!enabled || !el.isConnected) return;

    if (!res || !res.ok) {
      el.dataset.ltQueued = '0';
      el.classList.add('lt-failed');
      el.title = '翻译失败：' + ((res && res.error) || '未知错误');
      return;
    }

    const translated = norm(res.text);
    el.dataset.ltDone = '1';
    el.dataset.ltQueued = '0';

    if (!translated || translated === original) return;

    // 替换模式：先把原文包起来（此时还没插译文，所以包到的都是原文）
    if (settings.displayMode === 'replace') {
      wrapOriginal(el);
    }

    const box = document.createElement('span');
    box.className = 'lt-trans';
    box.setAttribute('dir', 'auto');
    box.setAttribute('translate', 'no');
    box.textContent = translated;
    el.appendChild(box);
  }

  // ================================================================
  // 替换模式：把原文文本节点包进 <span class="lt-orig">
  // 然后用 CSS 隐藏它。这样切回双语模式时可以干净还原。
  // ================================================================
  function wrapOriginal(el) {
    if (el.__ltOrigSpans) return;

    const spans = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const targets = [];

    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !/\S/.test(n.nodeValue)) continue;
      const p = n.parentElement;
      if (p && p.closest && p.closest('.lt-trans')) continue;
      targets.push(n);
    }

    for (const textNode of targets) {
      const parent = textNode.parentNode;
      if (!parent) continue;
      const span = document.createElement('span');
      span.className = 'lt-orig';
      parent.insertBefore(span, textNode);
      span.appendChild(textNode);
      spans.push(span);
    }

    el.__ltOrigSpans = spans;
  }

  function unwrapOriginal(el) {
    const spans = el.__ltOrigSpans;
    if (!spans) return;
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
    delete el.__ltOrigSpans;
  }

  /** 切换显示方式（对已经翻译过的元素也生效） */
  function applyDisplayMode() {
    if (settings.displayMode === 'replace') {
      document.documentElement.classList.add('lt-replace');
      document.querySelectorAll('[data-lt-done]').forEach((el) => {
        if (!el.__ltOrigSpans) wrapOriginal(el);
      });
    } else {
      document.documentElement.classList.remove('lt-replace');
      document.querySelectorAll('[data-lt-done]').forEach(unwrapOriginal);
    }
    return { ok: true, displayMode: settings.displayMode };
  }

  // ================================================================
  // 外观设置：颜色 / 字号 / 波浪线
  //
  // 全部走 CSS 变量 → 改完立刻生效，不需要重新翻译。
  // 这一点对"长页面已经翻完"的情况特别重要。
  // ================================================================

  /**
   * 把外观设置写进 CSS 变量。
   *
   * ★ v0.4：双语对照 与 直接替换 的外观【完全分开】。
   *
   *   对照模式（bilingual）—— 译文是"标注"
   *       文字色 / 背景色 / 波浪线 / 字号
   *   替换模式（replace）—— 译文是"正文"
   *       文字色 / 波浪线 / 字号（各自独立，默认跟随原文）
   *
   *   为什么分开？
   *     对照时原文还在，译文必须跳出来才分得清；
   *     替换时原文被藏了，译文再跳出来就成了满屏彩字，很累。
   *
   * 另外处理一个细节：主人选的背景是浅色（#FAFCFF），
   * 在深色网页上会变成刺眼白块 —— 这里做自适应，但只用默认浅色时才动。
   */
  function applyAppearance(a) {
    const root = document.documentElement;
    const isDarkPage = prefersDark();

    // ============ 一、双语对照模式 ============

    if (a.textColor) {
      root.style.setProperty('--lt-color', a.textColor);
      root.dataset.ltCustomColor = '1';
    } else {
      root.style.removeProperty('--lt-color');
      delete root.dataset.ltCustomColor;
    }

    // 背景色（带深浅自适应，只影响默认浅色）
    const LIGHT_DEFAULTS = ['#FAFCFF', '#FFFFFF'];
    if (a.bgColor) {
      const isDefaultLight = LIGHT_DEFAULTS.includes(a.bgColor.toUpperCase());
      if (isDarkPage && isDefaultLight) {
        root.style.setProperty('--lt-bg', 'rgba(255, 255, 255, .07)');
      } else {
        root.style.setProperty('--lt-bg', a.bgColor);
      }
    } else {
      root.style.removeProperty('--lt-bg');
    }

    // 波浪线（空 = 跟随文字色）
    const decoColor = a.underlineColor || a.textColor || '#0B5FA5';
    root.style.setProperty('--lt-deco', 'underline wavy ' + decoColor);

    // 字号
    if ((a.fontMode || 'scale') === 'fixed') {
      const px = Number(a.fontSize) || 16;
      root.style.setProperty('--lt-font-size', px + 'px');
      root.dataset.ltFixedFont = '1';
    } else {
      root.style.setProperty('--lt-scale', String(Number(a.fontScale) || 1));
      root.style.removeProperty('--lt-font-size');
      delete root.dataset.ltFixedFont;
    }

    // ============ 二、直接替换模式（独立设置） ============

    // 文字颜色：空 / 'inherit' → 跟随原文（这就是"原文黑、替换后也是黑"）
    const rColor = a.replaceTextColor;
    if (rColor && rColor !== 'inherit') {
      root.style.setProperty('--lt-r-color', rColor);
    } else {
      root.style.removeProperty('--lt-r-color');
    }

    // 波浪线：默认关闭（正文加波浪线很干扰阅读）
    if (a.replaceUnderline && a.replaceUnderline !== 'none') {
      root.style.setProperty('--lt-r-deco', 'underline wavy ' + a.replaceUnderline);
    } else {
      root.style.setProperty('--lt-r-deco', 'none');
    }

    // 字号（独立于对照模式）
    if ((a.replaceFontMode || 'scale') === 'fixed') {
      const px = Number(a.replaceFontSize) || 16;
      root.style.setProperty('--lt-r-font-size', px + 'px');
      root.dataset.ltRFixedFont = '1';
    } else {
      root.style.setProperty('--lt-r-scale', String(Number(a.replaceFontScale) || 1));
      root.style.removeProperty('--lt-r-font-size');
      delete root.dataset.ltRFixedFont;
    }

    return { ok: true, darkPage: isDarkPage };
  }

  /** 当前页面是否偏深色 */
  function prefersDark() {
    try {
      // ① 网页自己声明的主题
      if (document.documentElement.dataset.theme === 'dark') return true;
      if (document.documentElement.getAttribute('data-color-mode') === 'dark') return true;
      // ② 系统偏好
      if (window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
      // ③ 实测正文底色：太暗就认为页面是深色的
      const bg = getComputedStyle(document.body || document.documentElement)
        .backgroundColor;
      const m = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
        if (lum < 90) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 从 storage 读外观并应用 */
  async function loadAppearance() {
    const a = await chrome.storage.local.get({
      // 双语对照
      textColor: '#FF3705',
      bgColor: '#FAFCFF',
      underlineColor: '#0B5FA5',
      fontMode: 'scale',
      fontScale: 1,
      fontSize: 16,
      // 直接替换（独立）
      replaceTextColor: 'inherit',
      replaceUnderline: 'none',
      replaceFontMode: 'scale',
      replaceFontScale: 1,
      replaceFontSize: 16,
    });
    applyAppearance(a);
    return a;
  }

  // ================================================================
  // 启动 / 停止
  // ================================================================
  async function start() {
    if (enabled) return { ok: true, already: true, ...countStatus() };

    const stored = await chrome.storage.local.get({
      targetLang: 'zh-CN',
      displayMode: 'bilingual',
      translateMode: 'page',
      // 翻译范围：'precise' 精翻（默认） / 'full' 全翻译
      translateScope: 'precise',
      engine: 'mymemory',    // 用于决定并发数（智谱只能 1 并发）
      // 图片翻译相关
      imageTranslate: false,
      imageAuto: false,
    });

    // 翻译范围（影响文字过滤的严格程度）
    //   ★ 为什么在这里读、而不是在 loadSettings？★
    //     content.js 没有统一的 loadSettings，设置都在 start() 里读。
    //     而且它必须**在扫描文本之前**就位 —— 过滤函数要用它。
    settings.translateScope = stored.translateScope === 'full' ? 'full' : 'precise';

    // 图片翻译：开关打开时，给页面上的大图装上悬停按钮
    //   注意它和"开始翻译文字"是独立的 —— 即便用户只想翻图、
    //   不翻文字，这个也该生效。所以放在最前面，不受下面
    //   「只翻我选的」模式限制。
    settings.imageTranslate = !!stored.imageTranslate;
    settings.imageAuto = !!stored.imageAuto;
    // 字幕条外观（颜色 / 字号 / 是否显示原文）
    await loadImgLook();
    // 自动翻译（滚到哪翻到哪）—— 独立于悬停按钮
    if (settings.imageTranslate && settings.imageAuto) {
      startAutoImageTranslate();
    }

    // ★ 「只翻我选的」模式下，绝不允许整页翻译
    //   （双保险：面板已禁用按钮，这里再挡一次，防止任何路径误触发）
    if (stored.translateMode === 'selection') {
      return {
        ok: false,
        error: 'SELECTION_ONLY',
        message: '当前是「只翻我选的」模式：请选中文字后右键翻译',
      };
    }

    settings.targetLang = stored.targetLang;
    settings.displayMode = stored.displayMode;
    settings.engine = stored.engine;

    // 外观（颜色 / 字号）—— 在插入任何译文之前先设好，避免闪一下
    await loadAppearance();

    enabled = true;
    document.documentElement.classList.add('lt-on');
    if (settings.displayMode === 'replace') {
      document.documentElement.classList.add('lt-replace');
    }

    const hosts = collectHosts();

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            enqueue(entry.target);
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: VISIBLE_MARGIN, threshold: 0 }
    );

    for (const el of hosts) observer.observe(el);

    let inView = 0;
    for (const el of hosts) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight + 300 && r.bottom > -300) inView++;
    }

    return { ok: true, total: hosts.length, inView, displayMode: settings.displayMode };
  }

  function stop() {
    enabled = false;
    if (observer) { observer.disconnect(); observer = null; }
    queue.length = 0;
    pendingCount = 0;

    // 先还原被包裹的原文，再删译文
    document.querySelectorAll('[data-lt-done]').forEach(unwrapOriginal);
    document.querySelectorAll('.lt-trans').forEach((n) => n.remove());

    document.documentElement.classList.remove('lt-on');
    document.documentElement.classList.remove('lt-replace');

    document.querySelectorAll('[data-lt-done],[data-lt-queued]').forEach((el) => {
      delete el.dataset.ltDone;
      delete el.dataset.ltQueued;
      delete el.dataset.ltOriginal;
      el.classList.remove('lt-failed');
      el.removeAttribute('title');
    });

    return { ok: true };
  }

  function countStatus() {
    return {
      enabled,
      displayMode: settings.displayMode,
      translated: document.querySelectorAll('.lt-trans').length,
      queued: queue.length,
      pending: pendingCount,
      failed: document.querySelectorAll('.lt-failed').length,
    };
  }

  // ================================================================
  // 自动翻译
  //
  // 主人要的："不管什么网页都自动翻译"
  // 做法：加载后等页面稳定，就自动开翻。
  // 注意：这里遵守「只翻可见区域」的原则不变，
  //       所以自动开翻也不会卡。
  // ================================================================
  let autoStarted = false;

  async function maybeAutoStart() {
    if (autoStarted || enabled) return;

    const stored = await chrome.storage.local.get({
      autoTranslate: false,
      translateMode: 'page',
      targetLang: 'zh-CN',
      displayMode: 'bilingual',
    });

    // ★ 只翻选中模式：绝不自动翻整页
    if (stored.translateMode === 'selection') return;

    if (!stored.autoTranslate) return;

    // 页面本来就基本是中文 → 不折腾
    if (stored.targetLang.startsWith('zh')) {
      const sample = norm((document.body && document.body.textContent) || '').slice(0, 4000);
      if (sample.length > 200) {
        const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
        const latin = (sample.match(/[A-Za-z]/g) || []).length;
        // 中文字符占绝对多数 → 判定为中文页面，跳过自动翻译
        if (cjk > latin * 2) return;
      }
    }

    autoStarted = true;
    try {
      await start();
      // 通知面板（如果正开着）状态变了
      try {
        chrome.runtime.sendMessage({ type: 'auto-started' });
      } catch (e) { /* 没有接收方就算了 */ }
    } catch (e) {
      autoStarted = false;
    }
  }

  // 等页面稳定再自动开翻，避免和网站自身的加载抢资源
  function scheduleAutoStart() {
    setTimeout(() => {
      if (document.readyState === 'complete') {
        maybeAutoStart();
      } else {
        window.addEventListener('load', () => setTimeout(maybeAutoStart, 300), { once: true });
      }
    }, AUTO_DELAY);
  }

  // ================================================================
  // 划词即时翻译
  //
  // 自动识别总会漏（页面结构千奇百怪，不可能 100% 命中）。
  // 所以给主人一条"兜底通道"。
  //
  // 触发方式（三种，都保留）：
  //   ① 右键菜单「用 LiteTranslate 翻译这段」
  //   ② 浏览器快捷键 Alt+Shift+T（由 chrome.commands 提供，不受页面影响）
  //   ③ 页面内 Alt+T（部分站点可用，作为补充）
  //
  // 提示框带「复制」「关闭」按钮，点别处或 Esc 也会收起。
  // ================================================================
  let tipEl = null;

  function removeTip() {
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
  }

  /**
   * 建提示框。
   * 结构：<div class="lt-tip">
   *         <div class="lt-tip-body">译文</div>
   *         <div class="lt-tip-bar">
   *           <button class="lt-tip-copy">复制</button>
   *           <button class="lt-tip-close">×</button>
   *         </div>
   *       </div>
   */
  function buildTip(text, isError) {
    const box = document.createElement('div');
    box.className = 'lt-tip' + (isError ? ' lt-tip-err' : '');
    box.setAttribute('translate', 'no');

    const body = document.createElement('div');
    body.className = 'lt-tip-body';
    body.textContent = text;
    box.appendChild(body);

    const bar = document.createElement('div');
    bar.className = 'lt-tip-bar';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'lt-tip-btn lt-tip-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = body.textContent || '';
      try {
        await navigator.clipboard.writeText(t);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
      } catch (err) {
        copyBtn.textContent = '复制失败';
        setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'lt-tip-btn lt-tip-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTip();
    });

    bar.appendChild(copyBtn);
    bar.appendChild(closeBtn);
    box.appendChild(bar);

    // 点提示框本身不要冒泡到 window（否则会被"点别处关闭"逻辑误关）
    box.addEventListener('mousedown', (e) => e.stopPropagation());

    return box;
  }

  function placeTip(box, rect) {
    const tw = box.offsetWidth;
    const th = box.offsetHeight;

    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 8;

    const maxLeft = window.scrollX + document.documentElement.clientWidth - tw - 12;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);

    // 下方放不下就放到选区上方
    if (rect.bottom + th + 16 > window.innerHeight) {
      top = rect.top + window.scrollY - th - 8;
      if (top < window.scrollY + 4) top = rect.bottom + window.scrollY + 8;
    }

    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  function showTip(rect, text, isError) {
    removeTip();
    tipEl = buildTip(text, isError);
    document.body.appendChild(tipEl);
    placeTip(tipEl, rect);
  }

  /** 取当前选区的位置 */
  function getSelectionRect(sel) {
    try {
      const range = sel.getRangeAt(0);
      const r = range.getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
    } catch (e) { /* 忽略 */ }
    return { left: 20, top: 20, bottom: 40, right: 200 };
  }

  // 记住最近一次右键的位置。
  // 因为右键菜单被点击时，页面里的选区可能已经被浏览器折叠掉了，
  // 靠这个坐标才能把译文弹在用户刚才点的地方。
  let lastMenuPoint = null;
  window.addEventListener('contextmenu', (e) => {
    lastMenuPoint = { x: e.clientX, y: e.clientY };
  }, true);

  /** 把「鼠标坐标」转成一个 rect 形状的占位框，供 tip 定位 */
  function rectFromPoint(point) {
    if (!point) return null;
    return {
      left: point.x,
      top: point.y,
      right: point.x + 1,
      bottom: point.y + 1,
    };
  }

  /**
   * 翻译选区。
   *
   * @param {string} [providedText] 由右键菜单直接带来的选中文字。
   *        这是最可靠的来源 —— 因为右键点菜单时，页面选区可能已被折叠，
   *        再读 window.getSelection() 会得到空字符串（这就是"点了没反应"的根因）。
   * @param {{x:number,y:number}} [point] 右键点击的位置
   */
  async function translateSelection(providedText, point) {
    const sel = window.getSelection();
    const text = norm(providedText || (sel ? sel.toString() : ''));

    // ★ 读不到文字时，必须给用户反馈，不能默默返回
    if (!text) {
      const r = rectFromPoint(point || lastMenuPoint) ||
        { left: 20, top: 20, right: 220, bottom: 40 };
      showTip(
        r,
        '没读到选中的文字。请重新按住鼠标拖选一段，再用右键翻译；' +
        '或把文字粘贴到面板的「手动翻译」框里。',
        true
      );
      return { ok: false, error: 'EMPTY_SELECTION' };
    }

    // 位置优先级：右键点 → 选区位置 → 默认
    const rect = rectFromPoint(point || lastMenuPoint) ||
      getSelectionRect(sel);
    showTip(rect, '翻译中…', false);

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'translate', text });
    } catch (err) {
      showTip(rect, '翻译失败：插件通信中断，试试刷新页面', true);
      return { ok: false };
    }

    if (res && res.ok) {
      showTip(rect, res.text || '（没有返回内容）', false);
      return { ok: true, text: res.text };
    }

    // 错误提示尽量说清楚是什么原因
    const rawErr = (res && res.error) || '未知错误';
    let hint = rawErr;
    if (/429/.test(rawErr)) {
      hint = '免费额度用完了（HTTP 429）。到面板「翻译设置」里换个引擎，' +
        '或填 DeepSeek 的 Key。';
    } else if (/401|403/.test(rawErr)) {
      hint = 'Key 无效或没填（' + rawErr + '）。到面板「翻译设置」检查自定义引擎。';
    }

    showTip(rect, '翻译失败：' + hint, true);
    return { ok: false, error: rawErr };
  }

  // 供「重复注入」时复用：如果脚本被补注入第二次，
  // 让它可以再触发一次翻译，而不是绑一堆重复监听器。
  window.__liteTranslateRetrySelection = function () {
    const sel = window.getSelection();
    const t = sel ? norm(sel.toString()) : '';
    if (t) translateSelection(t, lastMenuPoint);
  };

  // 同上，但针对「翻译鼠标所指的图」。
  // 为什么要单独一个？因为补注入时得知道用户上次点的是哪个菜单项，
  // 见文件开头 __liteTranslatePending 的说明。
  window.__liteTranslateRetryImageHere = function () {
    const info = findImageLikeAtPoint(lastRightClick.x, lastRightClick.y);
    if (!info) {
      showImageError(
        '鼠标下面没找到图片。请把鼠标移到图片上再右键。',
        lastRightClick.el
      );
      return;
    }
    if (info.kind === 'canvas') {
      let url = '';
      try {
        url = info.el.toDataURL('image/jpeg', 0.82);
      } catch (e) {
        showImageError('这个 canvas 跨域了，读不到像素', info.el);
        return;
      }
      translateImageDataUrl(url, info.el, true).catch(() => {});
      return;
    }
    translateImageFromUrl(info.src, info.el, true).catch(() => {});
  };

  // 页面内快捷键（补充手段；浏览器级的是 Alt+Shift+T）
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      translateSelection();
    }
    if (e.key === 'Escape') removeTip();
  }, true);
  // 点别处收起
  window.addEventListener('mousedown', (e) => {
    if (tipEl && !tipEl.contains(e.target)) removeTip();
  }, true);

  // 页面滚动时，提示框跟着选区走（否则会飘在错的地方）
  window.addEventListener('scroll', () => {
    if (!tipEl) return;
    const sel = window.getSelection();
    if (!sel || !sel.toString()) { removeTip(); return; }
    placeTip(tipEl, getSelectionRect(sel));
  }, { passive: true });

  // ================================================================
  // 图片翻译（看图认字）
  //
  // 两种触发方式，共用同一套「抓图 → 压缩 → 请求 → 弹窗」流程：
  //   A. 右键图片 → 「用 LiteTranslate 翻译这张图」（精准，意图明确）
  //   B. 鼠标悬停在图上 → 右上角冒出小按钮（顺手，不用找右键）
  //
  // ★ 为什么不做「打开页面就自动翻所有图」？★
  //   实测一张图要 10~30 秒。一页 10 张图 = 等 2~5 分钟，
  //   而且按 token 计费。用户会以为插件卡死了。
  //   所以只做「用户明确指哪张就翻哪张」。
  // ================================================================

  let imgPanel = null;      // 当前的结果弹窗
  let imgCaption = null;    // 当前贴在图片下方的字幕条
  let imgBusy = false;      // 防止同时翻多张

  // 字幕条的外观（用户可在面板里改）
  //   默认：深色底 + 白字 + 15px + 只显示中文
  const imgLook = {
    showSource: false,
    textColor: '#ffffff',
    bgColor: 'rgba(17, 24, 39, .93)',
    fontSize: 15,
  };

  /** 从 storage 读字幕条外观 */
  async function loadImgLook() {
    const s = await chrome.storage.local.get({
      imgShowSource: false,
      imgTextColor: '#ffffff',
      imgBgColor: '#111827',
      imgFontSize: 15,
    });
    imgLook.showSource = !!s.imgShowSource;
    imgLook.textColor = s.imgTextColor || '#ffffff';
    imgLook.fontSize = Number(s.imgFontSize) || 15;
    // 底色：用户选的是纯色（如 #111827），转成带一点透明的
    const bg = s.imgBgColor || '#111827';
    imgLook.bgColor = hexToRgba(bg, 0.93);
  }

  /**
   * #rrggbb → rgba(r,g,b,a)
   *
   * 为什么不直接用十六进制？
   *   字幕条要盖在漫画上，完全不透明会显得很闷。
   *   留 7% 透明能让底下的画面隐隐透出来，看着更自然。
   */
  function hexToRgba(hex, alpha) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return 'rgba(17, 24, 39, ' + alpha + ')';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /**
   * 把图片画进 canvas 并压成 JPEG data URL。
   *
   * ★ 为什么要压缩？★
   *   原图动辄 1MB+，base64 后更大。视觉模型按 token 计费，
   *   尺寸越大越慢越贵。实测 1919x1019 → 压到 1280px 只要 116KB，
   *   图上的字依然看得清。
   *
   * ★ 为什么走 canvas 而不是直接把 URL 发给模型？★
   *   很多图片站有防盗链（Referer 检查），第三方服务器抓不到。
   *   在页面里用 canvas 是"就地取走"，最可靠。
   *   副作用：跨域图会被标脏（tainted），读像素时报错 ——
   *   下面会明确提示用户，不静默失败。
   */
  function imageToDataUrl(src, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width;
          const h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) {
            reject(new Error('图片尺寸为 0，可能还没加载完'));
            return;
          }

          const scale = Math.min(1, maxSide / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));

          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');

          // 先铺白底：透明 PNG 直接转 JPEG 会变黑
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          let url;
          try {
            url = cv.toDataURL('image/jpeg', 0.82);
          } catch (e) {
            reject(new Error('这张图来自其它网站，浏览器不允许读取它的像素。' +
              '可以先把它另存到本地，或换一张同站的图'));
            return;
          }
          if (!url || url.length < 100) {
            reject(new Error('图片压缩失败（可能是空图）'));
            return;
          }
          resolve(url);
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => reject(new Error('图片加载失败：' + String(src).slice(0, 80)));
      img.src = src;
    });
  }

  /** 关掉结果弹窗 */
  function closeImagePanel() {
    if (imgPanel && imgPanel.parentNode) imgPanel.parentNode.removeChild(imgPanel);
    imgPanel = null;
  }

  /**
   * 显示「翻译中…」占位框。
   *
   * ★ 为什么必须有？★
   *   模型要十几秒才回来。没有反馈的话用户以为没反应，
   *   然后反复点 —— 既浪费钱又更慢。
   */
  function showImageLoading(anchorEl) {
    closeImagePanel();

    const box = document.createElement('div');
    box.className = 'lt-imgbox';
    box.setAttribute('translate', 'no');
    box.innerHTML =
      '<div class="lt-imgbox-head">' +
      '<span class="lt-imgbox-title">正在识别图上的文字…</span>' +
      '<button class="lt-imgbox-x" title="关闭">×</button>' +
      '</div>' +
      '<div class="lt-imgbox-body">' +
      '<span class="lt-imgbox-spin"></span>' +
      '<span>大图约需 10~30 秒，请稍等</span>' +
      '</div>';

    box.querySelector('.lt-imgbox-x').addEventListener('click', closeImagePanel);
    document.documentElement.appendChild(box);
    placeImagePanel(box, anchorEl);
    imgPanel = box;
    return box;
  }

  /** 把弹窗放到图片旁边（尽量不挡住图本身） */
  function placeImagePanel(box, anchorEl) {
    const margin = 12;
    let x = margin;
    let y = margin;

    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      x = r.right + margin;
      y = r.top;
      if (x + 340 > window.innerWidth) {
        x = Math.max(margin, r.left - 340 - margin);
      }
      const boxH = Math.min(360, window.innerHeight - margin * 2);
      if (y + boxH > window.innerHeight) {
        y = Math.max(margin, window.innerHeight - boxH - margin);
      }
    }

    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
  }

  /** 面板内用的转义（防注入） */
  function escPanel(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 显示一个「错误」弹窗（不经过 loading 流程的场景用）。
   *
   * 什么时候用？
   *   canvas 跨域取不到像素这类「还没开始请求就失败」的情况。
   *   走不了 translateImageFromUrl 那套流程，但同样要给用户看到原因。
   */
  function showImageError(message, anchorEl) {
    closeImagePanel();

    const box = document.createElement('div');
    box.className = 'lt-imgbox';
    box.setAttribute('translate', 'no');
    box.innerHTML =
      '<div class="lt-imgbox-head">' +
      '<span class="lt-imgbox-title">翻译失败</span>' +
      '<button class="lt-imgbox-x" title="关闭">×</button>' +
      '</div>' +
      '<div class="lt-imgbox-body">' +
      '<div class="lt-imgbox-err">' + escPanel(message) + '</div>' +
      '</div>';

    box.querySelector('.lt-imgbox-x').addEventListener('click', closeImagePanel);
    document.documentElement.appendChild(box);
    placeImagePanel(box, anchorEl);
    imgPanel = box;
  }

  /**
   * 直接拿一个「已经是 data URL」的图去翻译。
   *
   * 和 translateImageFromUrl 的区别：
   *   · translateImageFromUrl 输入的是「网址」，要先加载再 canvas 压
   *   · 本函数输入的已经是 data URL（canvas 自己导出的），不用再加载
   *
   * 为什么要单独一个？canvas 导出的图再走一次 Image 加载纯属浪费
   * （还多一次编码解码），直接发出去最快。
   *
   * @param {boolean} manual 是不是用户手动触发的（右键/截图）
   *   true  → 不受「图片翻译」总开关限制（用户意图明确）
   *   false → 受开关限制（自动翻译队列走这条，防偷偷烧额度）
   */
  async function translateImageDataUrl(dataUrl, anchorEl, manual) {
    if (imgBusy) {
      showImageError('上一张还在翻，稍等一下', anchorEl);
      return;
    }
    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
      showImageError('canvas 导出失败（可能还没画完）', anchorEl);
      return;
    }

    imgBusy = true;
    const box = showImageLoading(anchorEl);

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'translate-image',
        imageDataUrl: dataUrl,
        // ★ manual 由调用者决定 ★
        //   translateImageDataUrl 有两个调用者：
        //     · 右键/截图（手动）→ manual=true，不受总开关限制
        //     · pumpAutoQueue（自动）→ manual=false，必须受开关限制
        //   所以这里不能写死，要跟着参数走。
        manual: !!manual,
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || '翻译失败');
      showImageResult(resp, anchorEl);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (box && box.parentNode) {
        const body = box.querySelector('.lt-imgbox-body');
        if (body) {
          body.innerHTML = '<div class="lt-imgbox-err">' + escPanel(msg) + '</div>';
        }
        const title = box.querySelector('.lt-imgbox-title');
        if (title) title.textContent = '翻译失败';
      }
    } finally {
      imgBusy = false;
    }
  }

  /**
   * 把「原文 → 译文」的文本拆成 [{src, dst}] 数组。
   *
   * 模型输出格式不总是完美的，所以要容错：
   *   「原文 → 译文」  ← 标准
   *   「原文 -> 译文」 ← 有些人这么写
   *   只有一行文字       ← 当成原文，dst 为空
   */
  function parseBilingualLines(text) {
    if (!text) return [];
    return String(text)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.*?)\s*(?:→|->|=>|➜)\s*(.*)$/);
        if (m) return { src: m[1].trim(), dst: m[2].trim() };
        return { src: line, dst: '' };
      })
      // 纯标点或纯符号的行丢掉
      .filter((it) => /[\w\u4e00-\u9fff\uac00-\ud7af\u3040-\u30ff]/.test(it.src + it.dst));
  }

  /**
   * 在图片**下面**贴一条「字幕条」。
   *
   * ★ 为什么是字幕条而不是盖在图上？★
   *   2026-10-14 实测结论：能免费看图的模型都**不返回文字坐标**
   *   （DeepSeek-OCR 的 grounding 在云端接口没开放；DeepSeek-V4-Flash
   *   在硅基流动上根本不是视觉模型，直接报 400）。
   *   没有坐标就不知道该把中文盖在哪，只能统一贴在底部。
   *   而且底部条还有个好处：漫画气泡里的字往往很小，
   *   贴出来用正常字号显示反而更好读。
   *
   * ★ 为什么用 absolute 定位而不是插到 DOM 里？★
   *   插进 DOM 会破坏网站自身布局（有些阅读器用 flex 排版，
   *   多一个子元素就会让图片变形）。用绝对定位贴在图片下方最安全，
   *   不动网站任何结构。
   */
  function showImageCaption(result, anchorEl) {
    // 先移除上一张图的字幕条
    if (imgCaption && imgCaption.parentNode) {
      imgCaption.parentNode.removeChild(imgCaption);
    }
    imgCaption = null;
    if (!anchorEl || !anchorEl.getBoundingClientRect) return;

    const pairs = parseBilingualLines(result.text);
    if (!pairs.length) return;

    const box = document.createElement('div');
    box.className = 'lt-imgcap';
    box.setAttribute('translate', 'no');

    const rows = pairs.map((p) => {
      let html = '';
      if (p.dst) {
        html += '<div class="lt-imgcap-cn">' + escPanel(p.dst) + '</div>';
        // 原文是否显示由 CSS 控制（.show-src）
        html += '<div class="lt-imgcap-src">' + escPanel(p.src) + '</div>';
      } else {
        html += '<div class="lt-imgcap-cn">' + escPanel(p.src) + '</div>';
      }
      return html;
    }).join('');

    box.innerHTML =
      '<div class="lt-imgcap-head">' +
      '<span>图上的文字（' + pairs.length + ' 处）</span>' +
      '<button class="lt-imgcap-x" title="关掉">×</button>' +
      '</div>' +
      '<div class="lt-imgcap-body">' + rows + '</div>';

    // ---- 应用用户设置的外观（颜色 / 字号 / 是否显示原文）----
    //   为什么用内联 style 而不是 CSS 类？
    //     这些值是用户自选的任意颜色，没法预定义成类。
    //     直接写内联变量最省事，而且只有这一个元素受影响。
    if (imgLook.showSource) box.classList.add('show-src');
    box.style.background = imgLook.bgColor || 'rgba(17,24,39,.93)';
    // 译文颜色 / 字号通过 CSS 变量传给子元素
    box.style.setProperty('--lt-cap-color', imgLook.textColor || '#ffffff');
    box.style.setProperty('--lt-cap-size', (imgLook.fontSize || 15) + 'px');

    // 关掉
    box.querySelector('.lt-imgcap-x').addEventListener('click', (e) => {
      e.stopPropagation();
      if (box.parentNode) box.parentNode.removeChild(box);
      if (imgCaption === box) imgCaption = null;
    });

    // 点一下切换「显示原文」
    box.querySelector('.lt-imgcap-head').addEventListener('click', (e) => {
      if (e.target.classList.contains('lt-imgcap-x')) return;
      box.classList.toggle('show-src');
    });

    document.documentElement.appendChild(box);

    // ---- 定位：贴在图片正下方（跟图片左边缘对齐） ----
    const r = anchorEl.getBoundingClientRect();
    const top = r.bottom + window.scrollY + 6;
    const left = Math.max(4, r.left + window.scrollX);

    box.style.position = 'absolute';
    box.style.top = Math.round(top) + 'px';
    box.style.left = Math.round(left) + 'px';
    // 宽度跟着图片走，但别超过视口
    const w = Math.min(Math.max(r.width, 260), window.innerWidth - 24);
    box.style.width = Math.round(w) + 'px';

    imgCaption = box;
  }

  /**
   * 显示结果。
   *
   * ★ 为什么把「原文 → 译文」拆成行？★
   *   模型返回的是一整段。拆成一行条，原文一行、译文一行，
   *   比一大坨好读，也方便对照。
   */
  function showImageResult(result, anchorEl) {
    // ★ 有明确的图片锚点时 → 贴「字幕条」在图片下面（主人选的方式）★
    //   没有锚点（比如手动调用）才退回弹窗。
    if (anchorEl && anchorEl.getBoundingClientRect) {
      showImageCaption(result, anchorEl);
      return;
    }

    closeImagePanel();

    const box = document.createElement('div');
    box.className = 'lt-imgbox';
    box.setAttribute('translate', 'no');

    const head = document.createElement('div');
    head.className = 'lt-imgbox-head';
    head.innerHTML =
      '<span class="lt-imgbox-title">图上的文字</span>' +
      '<button class="lt-imgbox-x" title="关闭">×</button>';
    box.appendChild(head);

    const body = document.createElement('div');
    body.className = 'lt-imgbox-body';

    if (!result.text) {
      body.innerHTML = '<div class="lt-imgbox-empty">没有找到文字</div>';
    } else {
      const lines = result.text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const rows = lines.map((line) => {
        // 箭头可能是 → 或 -> 或 =>
        const m = line.match(/^(.*?)\s*(?:→|->|=>)\s*(.*)$/);
        const src = m ? m[1] : line;
        const dst = m ? m[2] : '';
        return (
          '<div class="lt-imgrow">' +
          '<div class="lt-imgsrc">' + escPanel(src) + '</div>' +
          (dst ? '<div class="lt-imgdst">' + escPanel(dst) + '</div>' : '') +
          '</div>'
        );
      });

      body.innerHTML = '<div class="lt-imglist">' + rows.join('') + '</div>';
    }
    box.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'lt-imgbox-foot';
    const meta = result.ms ? Math.round(result.ms / 1000) + ' 秒' : '';
    foot.innerHTML =
      '<button class="lt-imgcopy">复制全部</button>' +
      '<span class="lt-imgmeta">' + escPanel(meta) + '</span>';
    box.appendChild(foot);

    head.querySelector('.lt-imgbox-x').addEventListener('click', closeImagePanel);
    foot.querySelector('.lt-imgcopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.text || '');
        const btn = foot.querySelector('.lt-imgcopy');
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = '复制全部'; }, 1500);
      } catch (e) { /* 忽略 */ }
    });

    document.documentElement.appendChild(box);
    placeImagePanel(box, anchorEl);
    imgPanel = box;
  }

  /**
   * 主流程：翻译一张图上的文字。
   *
   * @param {string} srcUrl  图片地址（右键菜单给的是 info.srcUrl）
   * @param {Element} anchor 用来定位弹窗的元素（可选）
   * @param {boolean} manual 是不是用户手动触发的（右键/截图）
   *   true  → 不受「图片翻译」总开关限制
   *   false → 受开关限制（自动翻译队列走这条）
   */
  async function translateImageFromUrl(srcUrl, anchor, manual) {
    if (imgBusy) return { ok: false, error: '上一张还在翻，稍等一下' };
    if (!srcUrl) return { ok: false, error: '没拿到图片地址' };

    imgBusy = true;
    const box = showImageLoading(anchor);

    try {
      // 1. 抓图 + 压缩
      const dataUrl = await imageToDataUrl(srcUrl, 1280);

      // 2. 交给后台调模型
      const resp = await chrome.runtime.sendMessage({
        type: 'translate-image',
        imageDataUrl: dataUrl,
        manual: !!manual,
      });

      if (!resp || !resp.ok) throw new Error((resp && resp.error) || '翻译失败');

      showImageResult(resp, anchor);
      return { ok: true };
    } catch (err) {
      // 失败也要让用户看到原因，不能静默
      const msg = (err && err.message) || String(err);
      if (box && box.parentNode) {
        const body = box.querySelector('.lt-imgbox-body');
        if (body) {
          body.innerHTML = '<div class="lt-imgbox-err">' + escPanel(msg) + '</div>';
        }
        const title = box.querySelector('.lt-imgbox-title');
        if (title) title.textContent = '翻译失败';
      }
      return { ok: false, error: msg };
    } finally {
      imgBusy = false;
    }
  }

  /**
   * 方式 B：鼠标悬停在图片上时，右上角冒出一个「译」按钮。
   *
   * ★ 为什么用悬停而不是全页自动翻？★
   *   全自动会让一页 10 张图排队跑 2~5 分钟。悬停是"指哪打哪"，
   *   主动权在用户手里，也不会突然烧钱。
   */
  /**
   * 判断一个元素是不是「图片类」，并返回取图方式。
   *
   * ★ 为什么不能只认 <img>？★
   *   2026-10-14 实测踩坑：韩漫站 lezhin.com 的「下拉式漫画」根本不是
   *   <img>。用 Chrome 开发者工具看，它是一个
   *     <div style="height:2560px; width:720px; overflow:hidden">
   *   也就是「用一个定高的 div 装一张超长图」。
   *   只监听 <img> 的话，这类站点永远出不来按钮。
   *
   * 三种渲染方式都要认：
   *   ① <img>       —— 最常见，能直接拿到 currentSrc
   *   ② 背景图       —— getComputedStyle 的 backgroundImage 里有 url(...)
   *   ③ <canvas>    —— 用 toDataURL 导出（漫画阅读器偶尔这么干）
   *
   * 顺序很重要：先 img 后 canvas 再 background。
   *   因为一个 <img> 元素也可能带 background，应该优先用它的 src。
   *
   * @returns {{kind:string, el:Element, src?:string}|null}
   */
  function detectImageLike(el) {
    if (!el || el.nodeType !== 1) return null;

    // ① <img>：currentSrc 才是浏览器实际选中的那个（响应式图会换源）
    if (el.tagName === 'IMG') {
      const src = el.currentSrc || el.src;
      if (src) return { kind: 'img', el, src };
      return null;
    }

    // ② <canvas>
    if (el.tagName === 'CANVAS') {
      return { kind: 'canvas', el };
    }

    // ③ 背景图
    //   注意：getComputedStyle 开销不小，所以只在「元素够大」时才查，
    //   否则页面上每个 div 都查一遍会把性能拖垮。
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) return null;

    let bg = '';
    try {
      bg = getComputedStyle(el).backgroundImage || '';
    } catch (e) {
      return null;
    }
    if (!bg || bg === 'none' || bg.indexOf('url(') === -1) return null;

    // 从 url("xxx") 里抠出地址，兼容单引号/双引号/无引号
    const m = bg.match(/url\((['"]?)(.*?)\1\)/);
    if (!m || !m[2]) return null;
    // 多个背景图叠在一起时，取第一个非渐变的
    if (m[2].indexOf('data:image/svg') === 0) return null;

    return { kind: 'bg', el, src: m[2] };
  }

  /**
   * 记录「最后一次右键的位置」。
   *
   * ★ 为什么需要它？★
   *   韩漫那种「定高 div + 背景图」的漫画，右键时浏览器不给
   *   info.srcUrl（因为元素不是 <img>），后台也不知道鼠标在哪。
   *   所以在页面里自己记一份坐标，右键菜单触发时用它反查元素。
   *
   * 用 contextmenu 而不是 mousedown：
   *   右键的 contextmenu 事件比 mousedown 更贴近"菜单即将弹出"的时刻，
   *   坐标也更准。
   */
  const lastRightClick = { x: 0, y: 0, el: null };

  document.addEventListener(
    'contextmenu',
    (e) => {
      lastRightClick.x = e.clientX;
      lastRightClick.y = e.clientY;
      lastRightClick.el = e.target;
    },
    true
  );

  /**
   * 从某个坐标往上找「图片类」元素。
   *
   * ★ 为什么要往上爬？★
   *   右键时 e.target 可能是图里的一层遮罩、一个定位用的空 div，
   *   图片本体在它的祖先上（韩漫站就是这样：div 套 div，最外层带背景图）。
   *
   * ★ 2026-10-14 修：加了「穿透」和「向下找」★
   *   原来只向上爬，结果在 Bing 图片搜索结果里报「鼠标下面没找到图片」。
   *   原因是：图片上面盖了一层透明链接 `<a>`，
   *   elementFromPoint 拿到的是那层 `<a>`，它的祖先里没有图片，
   *   而图片其实是它的**子元素**（`<a><img></a>`）。
   *   所以现在：① 先向上爬；② 爬不到就在子树里向下找；
   *             ③ 还不行就用 elementsFromPoint 拿"穿透列表"逐个试。
   *
   * @param {number} x  视口坐标
   * @param {number} y
   * @returns {{kind:string, el:Element, src?:string}|null}
   */
  function findImageLikeAtPoint(x, y) {
    const MIN_SIDE = 120;

    /** 元素够不够大（防止把图标当漫画） */
    function bigEnough(el) {
      try {
        const r = el.getBoundingClientRect();
        return r.width >= MIN_SIDE && r.height >= MIN_SIDE;
      } catch (e) {
        return false;
      }
    }

    /** 检查一个元素是不是图片类，是就返回 info */
    function tryElement(el) {
      if (!el || el.nodeType !== 1) return null;
      const info = detectImageLike(el);
      if (info && bigEnough(el)) return info;
      return null;
    }

    // ---------- 第一步：拿到鼠标底下的元素 ----------
    let base = null;
    try {
      base = document.elementFromPoint(x, y);
    } catch (e) { /* 坐标可能越界 */ }
    if (!base) base = lastRightClick.el;
    if (!base || base.nodeType !== 1) return null;

    // ---------- 第二步：向上爬（找祖先里的图） ----------
    let cur = base;
    let hops = 0;
    while (cur && hops < 8) {
      if (cur === document.body || cur === document.documentElement) break;
      const hit = tryElement(cur);
      if (hit) return hit;
      cur = cur.parentElement;
      hops++;
    }

    // ---------- 第三步：向下找（Bing 那种 <a><img></a>） ----------
    //   只找两层，避免在巨大的子树里遍历卡住
    let down = base;
    let depth = 0;
    while (down && depth < 2) {
      const kids = down.children || [];
      for (let i = 0; i < kids.length; i++) {
        const hit = tryElement(kids[i]);
        if (hit) return hit;
      }
      // 再看一层孙子
      if (depth === 0) {
        for (let i = 0; i < kids.length; i++) {
          const grand = kids[i].children || [];
          for (let j = 0; j < grand.length; j++) {
            const hit = tryElement(grand[j]);
            if (hit) return hit;
          }
        }
      }
      down = null;
      depth++;
    }

    // ---------- 第四步：穿透列表（最可靠的一招） ----------
    //   elementsFromPoint 会返回该坐标下**所有**叠在一起的元素（从顶到底）。
    //   上面都可能被透明层挡住，但列表里总有图片本体。
    try {
      const stack = document.elementsFromPoint(x, y) || [];
      for (const el2 of stack) {
        const hit = tryElement(el2);
        if (hit) return hit;
      }
    } catch (e) { /* 忽略 */ }

    return null;
  }


  // ================================================================
  // 自动翻译图片（滚到哪翻到哪）
  //
  // ★ 为什么不做「打开页面就翻全部」？★
  //   一张图 10~30 秒。一页 10 张要等 5 分钟，用户会以为卡死。
  //   而且全自动会瞬间烧掉几十次请求，免费额度撑不住。
  //
  // ★ 为什么用 IntersectionObserver？★
  //   和文字翻译用的是同一套技术（视口观察），已经被验证可靠。
  //   图片进入视口才翻 → 只花在用户真正在看的内容上。
  //
  // ★ 三道保护 ★
  //   ① 进入视口后**等 1 秒**才翻 —— 防止用户快速滚过时翻一堆没用的
  //   ② 每张图只翻一次（用 dataset 打标记）
  //   ③ 一次只翻一张（imgBusy 排队）—— 免得同时发 10 个请求
  // ================================================================
  let imgAutoObserver = null;
  const IMG_AUTO_DELAY = 1000;   // 进入视口后等这么久才翻
  let autoQueue = [];            // 等待翻译的图片
  let autoRunning = false;       // 队列是否在处理

  /** 一张图是不是「值得自动翻」（够大 + 不是已翻过） */
  function shouldAutoTranslate(el) {
    if (!el || el.dataset.ltImgDone === '1') return false;
    if (el.dataset.ltImgQueued === '1') return false;
    // 别翻自己插的元素
    if (el.closest && el.closest('.lt-imgcap, .lt-imgbox')) return false;

    const MIN_SIDE = 200;   // 自动模式门槛更高：只翻真正的大图
    try {
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    } catch (e) {
      return false;
    }
    return true;
  }

  /** 依次处理队列（一次一张，避免请求风暴） */
  async function pumpAutoQueue() {
    if (autoRunning) return;
    autoRunning = true;

    while (autoQueue.length) {
      const info = autoQueue.shift();
      // 用户可能已经把图滚走了 —— 那就跳过，别浪费额度
      try {
        const r = info.el.getBoundingClientRect();
        const stillVisible = r.bottom > -200 && r.top < window.innerHeight + 200;
        if (!stillVisible) {
          info.el.dataset.ltImgQueued = '0';
          continue;
        }
      } catch (e) { /* 元素可能已被移除 */ }

      try {
        if (info.kind === 'canvas') {
          const url = info.el.toDataURL('image/jpeg', 0.82);
          await translateImageDataUrl(url, info.el);
        } else {
          await translateImageFromUrl(info.src, info.el);
        }
      } catch (e) {
        // 自动模式下失败就安静跳过，不弹错误框打扰用户
      }
      info.el.dataset.ltImgQueued = '0';
      info.el.dataset.ltImgDone = '1';
    }

    autoRunning = false;
  }

  /** 开始自动翻译视口内的图片 */
  function startAutoImageTranslate() {
    if (imgAutoObserver) return;

    imgAutoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;

          // ★ 延迟 1 秒才真的翻 ★
          //   为什么？用户快速往下滚时，图片会一个个进入视口。
          //   如果立刻翻，滚过去的那些也全翻了 —— 白花钱。
          //   等 1 秒，还留在视口里的才是用户真在看的。
          setTimeout(() => {
            if (!imgAutoObserver) return;   // 期间被关掉了
            if (!shouldAutoTranslate(el)) return;

            const info = detectImageLike(el);
            if (!info) return;

            el.dataset.ltImgQueued = '1';
            autoQueue.push(info);
            pumpAutoQueue();
          }, IMG_AUTO_DELAY);

          imgAutoObserver.unobserve(el);   // 观察一次就够
        }
      },
      { rootMargin: '150px', threshold: 0 }
    );

    observeAutoImages();
    // ★ 关键：装上 DOM 监听，让后面动态加载的图也能被翻 ★
    //   没有这一步，下拉式漫画只有第一屏的图会被翻。
    installAutoImageWatch();
  }

  /**
   * 扫描页面上的图片元素，交给观察器。
   *
   * ★ 2026-10-14 两个 bug 的修复说明 ★
   *
   * Bug 1「往下滑不继续翻」：
   *   原来只在启动时扫一次。但下拉式漫画是**边滚边加载**的 ——
   *   新出现的图从来没被观察过，所以永远不翻。
   *   修法：加 MutationObserver 盯着 DOM 变化，有新图就补观察
   *   （见 installAutoImageWatch）。
   *
   * Bug 2「背景图扫不到」：
   *   原来用 `div[style*="background"]` 找背景图容器，
   *   但样式通常写在 CSS 类里而不是行内 style，
   *   韩漫那种 `<div class="x" style="height:2560px">` 根本匹配不到。
   *   修法：不再猜选择器，改成「扫描所有尺寸够大的元素」，
   *   由 detectImageLike 去判断它到底有没有图。
   *   为了不卡，扫描做批处理（下面 CHUNK 那段）。
   */
  function observeAutoImages() {
    if (!imgAutoObserver) return;

    const MIN_SIDE = 200;

    /** 把一个元素交给观察器（去重） */
    function watch(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.dataset.ltImgObserved === '1') return;
      // 够大才值得观察（小的肯定是图标）
      try {
        const r = el.getBoundingClientRect();
        // 注意：还没进视口的图 height 可能是 0（懒加载占位），
        // 所以这里用 offsetWidth/Height 兜底判断"它占不占地方"
        const w = r.width || el.offsetWidth || 0;
        const h = r.height || el.offsetHeight || 0;
        if (w < MIN_SIDE || h < MIN_SIDE) return;
      } catch (e) {
        return;
      }
      el.dataset.ltImgObserved = '1';
      imgAutoObserver.observe(el);
    }

    // ① <img> / <canvas>：直接看标签，快
    const nodes = document.querySelectorAll('img, canvas');
    for (const el of nodes) watch(el);

    // ② 背景图：不猜选择器，扫所有 div/section/article/a
    //    ★ 为什么敢全扫？★
    //      这些是页面上的"容器类"元素，通常几百到几千个。
    //      每次只做 getBoundingClientRect（浏览器有缓存，很快），
    //      而且只在启动和 DOM 变化时跑，不在滚动时跑。
    //      实测这个量级（几千个元素）耗时在 10ms 以内。
    const boxes = document.querySelectorAll('div, section, article, a');
    for (const el of boxes) watch(el);
  }

  /**
   * 盯着 DOM 变化，新出现的图也纳入观察。
   *
   * ★ 为什么必须要有这个？★
   *   下拉式漫画、无限滚动列表、React 换页 —— 都是边滚边插新节点。
   *   不监听 DOM 的话，只有"打开页面时就存在的图"会被翻，
   *   后面滚出来的全部漏掉（这正是主人反馈的「往下滑没继续翻」）。
   *
   * ★ 为什么要节流？★
   *   DOM 变化可能非常频繁（动画、打字、动态加载）。
   *   每变一次就全量扫一遍会卡。所以攒 500ms 再扫一次。
   */
  let autoDomWatcher = null;
  let autoRescanTimer = null;

  function installAutoImageWatch() {
    if (autoDomWatcher) return;

    autoDomWatcher = new MutationObserver((records) => {
      // 只关心「加了新节点」的变化
      let hasNew = false;
      for (const rec of records) {
        if (rec.addedNodes && rec.addedNodes.length) {
          hasNew = true;
          break;
        }
      }
      if (!hasNew) return;

      if (autoRescanTimer) return;
      autoRescanTimer = setTimeout(() => {
        autoRescanTimer = null;
        if (!imgAutoObserver) return;
        observeAutoImages();
      }, 500);
    });

    autoDomWatcher.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /** 停止自动翻译 */
  function stopAutoImageTranslate() {
    if (imgAutoObserver) {
      imgAutoObserver.disconnect();
      imgAutoObserver = null;
    }
    if (autoDomWatcher) {
      autoDomWatcher.disconnect();
      autoDomWatcher = null;
    }
    if (autoRescanTimer) {
      clearTimeout(autoRescanTimer);
      autoRescanTimer = null;
    }
    autoQueue = [];
    autoRunning = false;
    // 清掉标记，下次开启还能重新翻
    document.querySelectorAll('[data-lt-img-observed]').forEach((el) => {
      delete el.dataset.ltImgObserved;
    });
  }

  // ================================================================
  // 截图翻译（框选屏幕任意区域）
  //
  // ★ 为什么需要它？★
  //   前面那套「图片翻译」只认页面上的 <img> / 背景图 / canvas。
  //   但实际会遇到：
  //     · 漫画是视频 / 跨域 canvas（读不到像素）
  //     · 网站把图藏在奇怪的容器里，抓不到
  //     · 内容根本不是图（比如视频里的字幕）
  //   截图翻译是万能兜底：用户框哪块就翻哪块，不看页面结构。
  //
  // ★ 谁在真正截图？★
  //   扩展没有直接的"截屏" API。popup 可以用
  //   chrome.tabs.captureVisibleTab 截当前标签页的可见区域。
  //   content.js 只负责：
  //     ① 画遮罩层让用户拖框
  //     ② 把框坐标报给 popup
  //     ③ 在页面上贴译文（复用现有的字幕条）
  //
  // ★ 坐标为什么是 clientX/clientY？★
  //   captureVisibleTab 截的是**当前视口**（不含滚动偏移），
  //   而 clientX/clientY 正好是视口坐标，两边能对上。
  //   （页面滚动过也没关系 —— 视口截图跟滚动位置无关。）
  // ================================================================

  let shotMask = null;
  // 截图框的位置（视口坐标）——用来把译文贴在框附近
  let lastShotRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

  /** 去掉截图遮罩 */
  function removeShotMask() {
    if (shotMask && shotMask.parentNode) shotMask.parentNode.removeChild(shotMask);
    shotMask = null;
  }

  /**
   * 进入「截图选区域」模式。
   *
   * @returns {Promise<{x:number,y:number,w:number,h:number}|null>}
   *          选框的视口坐标（CSS 像素）；用户取消返回 null
   */
  function pickScreenArea() {
    return new Promise((resolve) => {
      removeShotMask();

      const mask = document.createElement('div');
      mask.className = 'lt-shotmask';
      mask.setAttribute('translate', 'no');

      const rect = document.createElement('div');
      rect.className = 'lt-shotrect';
      mask.appendChild(rect);

      const tip = document.createElement('div');
      tip.className = 'lt-shottip';
      tip.textContent = '拖动鼠标框住要翻译的地方　·　Esc 或右键取消';
      mask.appendChild(tip);

      document.documentElement.appendChild(mask);
      shotMask = mask;

      let startX = 0;
      let startY = 0;
      let dragging = false;
      let done = false;

      function finish(result) {
        if (done) return;
        done = true;
        removeShotMask();
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
      }

      function drawRect(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        rect.style.left = left + 'px';
        rect.style.top = top + 'px';
        rect.style.width = w + 'px';
        rect.style.height = h + 'px';
        return { left, top, w, h };
      }

      mask.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;   // 只认左键
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        rect.style.display = 'block';
        drawRect(startX, startY, startX, startY);
      });

      mask.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        drawRect(startX, startY, e.clientX, e.clientY);
      });

      mask.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        const r = drawRect(startX, startY, e.clientX, e.clientY);

        // 太小当误触，让用户重来（避免截到几个像素）
        if (r.w < 12 || r.h < 12) {
          tip.textContent = '框太小了，请重新拖一个大一点的区域';
          rect.style.display = 'none';
          return;
        }

        finish({ x: r.left, y: r.top, w: r.w, h: r.h });
      });

      mask.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        finish(null);
      });

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }
      document.addEventListener('keydown', onKey, true);
    });
  }

  /**
   * 截图翻译的第 ④ 步：裁剪 → 调模型 → 贴译文。
   *
   * 为什么在页面里做而不是后台？
   *   裁剪要用 canvas，Service Worker 里没有 DOM/canvas。
   *
   * @param {string} fullDataUrl 整屏截图（后台 captureVisibleTab 给的）
   * @param {object} area        框选区域（视口 CSS 坐标）
   */
  async function shotCropAndTranslate(fullDataUrl, area) {
    if (!fullDataUrl || !area) throw new Error('截图数据不完整');

    // ---- 裁剪 ----
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('截图加载失败'));
      im.src = fullDataUrl;
    });

    // ★ 坐标换算 ★
    //   截图的实际像素 ÷ 视口 CSS 尺寸 = 真实缩放比。
    //   高分辨率屏（150% 缩放之类）上两者不相等，直接按 CSS 坐标裁会偏。
    const scaleX = img.naturalWidth / window.innerWidth;
    const scaleY = img.naturalHeight / window.innerHeight;

    const sx = Math.max(0, Math.round(area.x * scaleX));
    const sy = Math.max(0, Math.round(area.y * scaleY));
    const sw = Math.max(1, Math.round(area.w * scaleX));
    const sh = Math.max(1, Math.round(area.h * scaleY));

    const cv = document.createElement('canvas');
    cv.width = sw;
    cv.height = sh;
    const ctx = cv.getContext('2d');
    // 铺白底：截图可能带透明通道，转 JPEG 会变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // 最长边压到 1280（跟图片翻译一致：够清晰又省 token）
    const MAX = 1280;
    let out = cv;
    if (Math.max(sw, sh) > MAX) {
      const r = MAX / Math.max(sw, sh);
      const cv2 = document.createElement('canvas');
      cv2.width = Math.round(sw * r);
      cv2.height = Math.round(sh * r);
      const c2 = cv2.getContext('2d');
      c2.fillStyle = '#ffffff';
      c2.fillRect(0, 0, cv2.width, cv2.height);
      c2.drawImage(cv, 0, 0, cv2.width, cv2.height);
      out = cv2;
    }
    const dataUrl = out.toDataURL('image/jpeg', 0.85);

    // ---- 记住框的位置（好把译文贴在下方）----
    lastShotRect = {
      left: area.x,
      top: area.y,
      right: area.x + area.w,
      bottom: area.y + area.h,
      width: area.w,
      height: area.h,
    };

    // ---- 调模型 ----
    //   ★ 带 manual: true ★
    //     截图翻译是用户亲手点、亲手拖的，意图明确，
    //     不该被「图片翻译总开关」挡住（主人的实测反馈：
    //     开关没开时截图翻译"点了没反应"）
    const resp = await chrome.runtime.sendMessage({
      type: 'translate-image',
      imageDataUrl: dataUrl,
      manual: true,
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || '翻译失败');

    // ---- 贴译文（复用图片字幕条）----
    showImageCaption(
      { text: resp.text, ms: resp.ms },
      { getBoundingClientRect: () => lastShotRect }
    );

    return { ok: true };
  }

  // ================================================================
  // 消息接口
  // ================================================================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'toggle') {
      if (msg.on) {
        start()
          .then(sendResponse)
          .catch((e) => sendResponse({ ok: false, error: String(e) }));
      } else {
        sendResponse(stop());
      }
      return true;
    }

    if (msg.type === 'status') {
      sendResponse({ ok: true, ...countStatus() });
      return true;
    }

    if (msg.type === 'set-display-mode') {
      settings.displayMode = msg.mode === 'replace' ? 'replace' : 'bilingual';
      sendResponse(applyDisplayMode());
      return true;
    }

    // 外观设置：颜色 / 字号 / 波浪线
    // 走 CSS 变量，改完立刻生效，不需要重新翻译
    if (msg.type === 'set-appearance') {
      sendResponse(applyAppearance(msg.appearance || {}));
      return true;
    }

    // 划词翻译（面板 / 右键菜单 / 快捷键都走这里）
    // text  : 可选。右键菜单会把它带来的选中文字直接传进来 —— 最可靠。
    // point : 可选。右键点击的坐标，用来把译文弹在正确位置。
    if (msg.type === 'translate-selection') {
      translateSelection(msg.text, msg.point)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    // 面板模式切换（网站模式 ↔ 漫画模式）
    //
    // ★ 为什么要停掉另一边？★
    //   网站模式的「整页翻译」和漫画模式的「图片翻译」都会调
    //   同一个硅基流动 Key。如果切到漫画模式时网页翻译还在跑，
    //   两边会抢额度、互相排队（主人实测反馈过）。
    //   所以：切到漫画模式 → 停掉网页文字翻译；
    //        切回网站模式 → 若之前开着，恢复它。
    if (msg.type === 'set-mode') {
      const toComic = msg.mode === 'comic';
      if (toComic) {
        // 进漫画模式：记住文字翻译原来开没开，然后停掉
        modeSiteWasOn = enabled;
        if (enabled) stop();
        // 停掉文字翻译后，开启漫画图片翻译（如果设置里开着）
        if (settings.imageTranslate && settings.imageAuto) {
          startAutoImageTranslate();
        }
      } else {
        // 回网站模式：停掉图片自动翻译，恢复文字翻译
        stopAutoImageTranslate();
        if (modeSiteWasOn) start();
      }
      sendResponse({ ok: true });
      return true;
    }

    // 手动重新扫描（有些站点内容加载慢）
    if (msg.type === 'rescan') {
      if (!enabled || !observer) {
        sendResponse({ ok: false, error: '还没开始翻译' });
      } else {
        const hosts = collectHosts();
        for (const el of hosts) observer.observe(el);
        sendResponse({ ok: true, added: hosts.length });
      }
      return true;
    }

    // 右键图片 → 翻译图上的文字
    //   manual=true：用户点了右键菜单，意图明确，不受总开关限制
    if (msg.type === 'translate-image') {
      translateImageFromUrl(msg.srcUrl, undefined, true)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    // 右键「鼠标所指的图」→ 自己去底下找
    //
    // ★ 为什么需要这条？★
    //   韩漫那种「定高 div + 背景图」的页面，右键时浏览器
    //   不会给 info.srcUrl（因为它不是 <img>）。
    //   所以我们记下最后一次右键的坐标，从那儿往上找图片元素。
    if (msg.type === 'translate-image-here') {
      // 记下"用户点的是图片翻译"。
      // 万一这条消息让脚本被补注入（见文件开头），
      // 补注入时就知道该重试图片翻译而不是选区翻译。
      window.__liteTranslatePending = 'image-here';
      const info = findImageLikeAtPoint(lastRightClick.x, lastRightClick.y);
      if (!info) {
        showImageError(
          '鼠标下面没找到图片。请把鼠标移到漫画图上再右键。',
          lastRightClick.el
        );
        sendResponse({ ok: false, error: '没找到图片' });
        return true;
      }
      if (info.kind === 'canvas') {
        let url = '';
        try {
          url = info.el.toDataURL('image/jpeg', 0.82);
        } catch (e) {
          showImageError('这个 canvas 跨域了，读不到像素', info.el);
          sendResponse({ ok: false, error: 'canvas 跨域' });
          return true;
        }
        // manual=true：右键「鼠标所指的图」，用户主动点的
        translateImageDataUrl(url, info.el, true)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true;
      }
      translateImageFromUrl(info.src, info.el, true)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    // ============ 截图翻译 ============
    //
    // ① 让页面进入框选模式，把坐标回给后台。
    //    为什么截图不在这里做？captureVisibleTab 是扩展级 API，
    //    页面里（content script）调不了，必须由后台来截。
    //
    //    ★ 立刻响应，不等用户拖框 ★
    //      拖框要好几秒，而 sendResponse 拖太久消息通道会自动关闭
    //      （Chrome 的限制），后台就永远收不到结果了。
    //      所以这里「先答应下来」，等用户拖完了**再主动发一条消息**。
    if (msg.type === 'pick-area') {
      sendResponse({ ok: true, accepted: true });

      pickScreenArea()
        .then((area) => {
          // 用户拖完了（或取消了）—— 把结果主动推给后台
          chrome.runtime
            .sendMessage({ type: 'shot-area-picked', area })
            .catch(() => {});
        })
        .catch(() => {
          chrome.runtime
            .sendMessage({ type: 'shot-area-picked', area: null })
            .catch(() => {});
        });

      return true;
    }

    // ② 框好了，popup 告诉页面"框在哪"，好把译文贴在附近
    if (msg.type === 'remember-shot-rect') {
      const a = msg.area || {};
      lastShotRect = {
        left: a.x || 0,
        top: a.y || 0,
        right: (a.x || 0) + (a.w || 0),
        bottom: (a.y || 0) + (a.h || 0),
        // 贴上译文时要算滚动偏移（getBoundingClientRect 是视口坐标，
        // 而字幕条用的是文档坐标）
        width: a.w || 0,
        height: a.h || 0,
      };
      sendResponse({ ok: true });
      return true;
    }

    // ③ 结果显示：复用图片字幕条那套（贴在框的下方）
    if (msg.type === 'show-shot-result') {
      showImageCaption(
        { text: msg.text, ms: msg.ms },
        { getBoundingClientRect: () => lastShotRect }
      );
      sendResponse({ ok: true });
      return true;
    }

    // ④ 后台截好整屏图了，交给页面裁剪 + 调模型 + 贴译文
    //
    // ★ 为什么这一步在页面做？★
    //   裁剪要用 canvas，而 Service Worker 里没有 DOM/canvas。
    //   页面有 canvas，所以裁回页面做。
    if (msg.type === 'shot-crop-and-go') {
      shotCropAndTranslate(msg.fullImage, msg.area)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    // ⑤ 截图翻译中途失败 —— 在页面上弹个提示
    //    为什么要有这个？因为 popup 已经关了，
    //    用户看不到任何状态栏，失败必须显示在页面上。
    if (msg.type === 'shot-failed') {
      showImageError('截图翻译失败：' + (msg.error || '未知原因'), null);
      sendResponse({ ok: true });
      return true;
    }
  });

  // ================================================================
  // SPA 动态内容补扫
  // ================================================================
  let rescanTimer = null;

  function scheduleRescan() {
    if (!enabled || rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      if (!enabled || !observer) return;
      for (const el of collectHosts()) observer.observe(el);
    }, RESCAN_DELAY);
  }

  const mo = new MutationObserver(() => {
    if (enabled) scheduleRescan();
  });

  function attachObserver() {
    if (!document.body) return;
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) attachObserver();
  else document.addEventListener('DOMContentLoaded', attachObserver, { once: true });

  // 自动翻译：等页面稳定后自行开翻
  scheduleAutoStart();
})();
