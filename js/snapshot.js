/* =========================================================
   صورة الشبكة لنهاية اليوم
   تبني صورة PNG مرتبة: الشعارات + العنوان + التاريخ + الشبكة + العدد
   وتنزّلها باسم فيه تاريخ اليوم. (زر صغير تحت، أو حرف S)
   ========================================================= */
(function () {
  'use strict';

  const FONT = 'Rubik, "Segoe UI", Tahoma, sans-serif';
  const C = {
    bg: '#f3effb', dot: '#ddd2f4', panel: '#f8f5fe', white: '#ffffff',
    navy: '#1e1240', purple: '#7e36e2', green: '#2f9e45', muted: '#6e6693'
  };
  const S = 2;      // دقة الشبكة (ضعف مقاسها على الشاشة)
  const PAD = 80;   // هامش الصورة

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function isoDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function build({ network, count, todayCount, dateText }) {
    const assets = window.SNAPSHOT_ASSETS || {};
    const [aiclub, fcit] = await Promise.all([
      loadImage(assets.aiclub || 'assets/img/aiclub-logo.png'),
      loadImage(assets.fcit || 'assets/img/fcit-logo.png')
    ]);

    const net = network.renderSnapshot(S);
    const HEAD = 315, FOOT = 120;
    const W = net.width + PAD * 2;
    const H = HEAD + net.height + FOOT + PAD;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    // الخلفية المنقطة
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.dot;
    for (let y = 20; y < H; y += 48) {
      for (let x = 12; x < W; x += 48) {
        ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // الشعارات (يسار)
    let lx = PAD;
    const logoMid = PAD + 55;
    if (aiclub) {
      const h = 76, w = (aiclub.naturalWidth / aiclub.naturalHeight) * h;
      ctx.drawImage(aiclub, lx, logoMid - h / 2, w, h);
      lx += w + 40;
    }
    if (fcit) {
      const h = 120, w = (fcit.naturalWidth / fcit.naturalHeight) * h;
      ctx.drawImage(fcit, lx, logoMid - h / 2, w, h);
    }

    // العنوان (يمين): «شبكتنا تكبر» + «بكم» بالبنفسجي
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    const right = W - PAD;
    ctx.font = `900 104px ${FONT}`;
    const part1 = 'شبكتنا تكبر ';
    const w1 = ctx.measureText(part1).width;
    ctx.fillStyle = C.navy;
    ctx.fillText(part1, right, PAD + 96);
    ctx.fillStyle = C.purple;
    ctx.fillText('بكم', right - w1, PAD + 96);

    ctx.font = `500 36px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`${dateText} · Dev Week · بوث نادي الذكاء الاصطناعي`, right, PAD + 172);

    // لوحة الشبكة
    const top = HEAD;
    ctx.save();
    ctx.shadowColor = 'rgba(90, 50, 170, 0.10)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, PAD, top, net.width, net.height, 44);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, PAD, top, net.width, net.height, 44);
    ctx.clip();
    ctx.drawImage(net, PAD, top);
    ctx.restore();

    // الأسفل: العدد (يمين) والهاشتاق (يسار)
    const fy = top + net.height + 78;
    const toAr = (n) => Number(n).toLocaleString('ar-SA-u-nu-arab');
    ctx.textAlign = 'right';
    ctx.font = `900 64px ${FONT}`;
    const num = toAr(count);
    const nw = ctx.measureText(num + ' ').width;
    ctx.fillStyle = C.purple;
    ctx.fillText(num, right, fy);
    ctx.font = `500 34px ${FONT}`;
    ctx.fillStyle = C.muted;
    const label = 'اسم أضاء شبكتنا';
    ctx.fillText(label, right - nw, fy - 6);

    // كم سجّل اليوم (يوم التنزيل)
    if (todayCount != null) {
      const lw = ctx.measureText(label + '   ').width;
      const x = right - nw - lw;
      const today = `· منهم ${toAr(todayCount)} اليوم`;
      ctx.font = `700 34px ${FONT}`;
      ctx.fillStyle = C.green;
      ctx.fillText(today, x, fy - 6);
    }

    ctx.textAlign = 'left';
    ctx.direction = 'rtl';
    ctx.font = `800 46px ${FONT}`;
    ctx.fillStyle = C.green;
    ctx.fillText('#نقود_المستقبل', PAD, fy - 4);

    return cv;
  }

  async function download(opts) {
    const cv = await build(opts);
    const name = `شبكة-DevWeek-${isoDate(new Date())}.png`;
    await new Promise((resolve) => {
      try {
        cv.toBlob((blob) => {
          if (!blob) { console.warn('[Booth] تعذّر حفظ صورة الشبكة'); return resolve(); }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          resolve();
        }, 'image/png');
      } catch (err) {
        console.warn('[Booth] تعذّر حفظ صورة الشبكة:', err.message);
        resolve();
      }
    });
  }

  window.BoothSnapshot = { build, download };
})();
