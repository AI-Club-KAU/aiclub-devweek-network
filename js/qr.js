/* =========================================================
   رسم الباركود بنفس ستايل التصميم (مربعات دائرية + شعار بالنص)
   يستخدم مكتبة qrcode-generator (js/vendor/qrcode.js)
   ========================================================= */
(function () {
  'use strict';

  const NAVY = '#1e1240';
  const PURPLE = '#7e36e2';
  const LOGO = 'assets/img/aiclub-mark-navy.png';

  function safeUrl(url) {
    try { return encodeURI(decodeURI(String(url).trim())); } catch (e) { return String(url).trim(); }
  }

  window.renderQR = function (container, url) {
    const qr = qrcode(0, 'H'); // H = يتحمّل تغطية الشعار
    qr.addData(safeUrl(url));
    qr.make();

    const n = qr.getModuleCount();
    const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // مساحة الشعار بالنص
    let span = Math.round(n * 0.24);
    if ((n - span) % 2) span += 1;
    const start = (n - span) / 2;
    const inLogo = (r, c) => r >= start && r < start + span && c >= start && c < start + span;

    let modules = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c) || inFinder(r, c) || inLogo(r, c)) continue;
        modules += `<rect x="${c + 0.08}" y="${r + 0.08}" width="0.84" height="0.84" rx="0.24"/>`;
      }
    }

    const finder = (x, y) =>
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.7" fill="none" stroke="${NAVY}" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.85" fill="${PURPLE}"/>`;

    const logoSize = span * 0.82;
    const logoPos = (n - logoSize) / 2;

    container.innerHTML =
      `<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">` +
      `<g fill="${NAVY}">${modules}</g>` +
      finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) +
      `<image href="${LOGO}" x="${logoPos}" y="${logoPos}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>` +
      `</svg>`;
  };
})();
