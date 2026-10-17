/**
 * 功能介绍独立窗口的脚本（2026-10-17）
 *
 * 职责很小：
 *   ① 关闭窗口（× / Esc）
 *   ② 跟随插件面板当前的皮肤（浅色 / 深色 / 圆润）
 *
 * ★ 为什么关窗口要用 window.close() 而不是关 DOM？★
 *   这个页面是用 chrome.windows.create 单独开的一个浏览器窗口，
 *   关掉 DOM 只留个白板在那儿。直接 window.close() 才是真的关窗。
 *
 * ★ 为什么皮肤要单独读一次 storage？★
 *   独立窗口是另一份文档，不共享 popup 的 CSS 状态。
 *   所以打开时去 storage 里读一次用户选的皮肤，套上 body 的类。
 */

(function () {
  'use strict';

  // -------------------- 关闭 --------------------
  function closeMe() {
    // 说明：脚本打开的窗口（chrome.windows.create）允许 window.close()。
    window.close();
    // 兜底：万一浏览器不允许关（比如以后被改成标签页打开），
    // 至少把内容清掉，别让人对着空白页。
    setTimeout(function () {
      try {
        if (!window.closed) {
          document.body.innerHTML =
            '<div style="padding:40px;text-align:center;color:#888;">' +
            '可以关掉这个窗口了。</div>';
        }
      } catch (e) { /* 忽略 */ }
    }, 120);
  }

  const btnClose = document.getElementById('btnClose');
  if (btnClose) btnClose.addEventListener('click', closeMe);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMe();
  });

  // -------------------- 皮肤 --------------------
  // 跟 popup.js 里 PANEL_DEFAULTS.panelSkin 的取值保持一致
  const VALID = ['minimal', 'dark', 'soft'];

  function applySkin(name) {
    const skin = VALID.indexOf(name) >= 0 ? name : 'minimal';
    VALID.forEach(function (s) { document.body.classList.remove('skin-' + s); });
    document.body.classList.add('skin-' + skin);
  }

  try {
    chrome.storage.local.get({ panelSkin: 'minimal' }, function (p) {
      applySkin(p && p.panelSkin);
    });

    // 用户可能在别的地方改了皮肤，这边跟着变
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.panelSkin) {
        applySkin(changes.panelSkin.newValue);
      }
    });
  } catch (e) {
    // storage 读不到（极少见）就用默认浅色，不影响阅读
    applySkin('minimal');
  }
})();
