/* =========================================================
   مصدر الأسماء
   ١) dataUrl في config.js  → الشاشة تسحب القائمة كل كم ثانية
   ٢) Booth.addVisitor({ name, kaust }) → إضافة مباشرة من أي كود
   ٣) BroadcastChannel('devweek-booth') → لو صفحة التسجيل مفتوحة على نفس الجهاز
   ٤) بدون ربط → أسماء تجريبية
   ========================================================= */
(function () {
  'use strict';

  const cfg = window.BOOTH_CONFIG;

  // يطلع مصفوفة المسجّلين من أي شكل JSON شائع
  function extractList(json) {
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object') {
      for (const k of ['visitors', 'data', 'items', 'records', 'rows', 'attendees']) {
        if (Array.isArray(json[k])) return json[k];
      }
    }
    return [];
  }

  function startPolling(handlers) {
    let seen = -1;
    async function poll() {
      try {
        const res = await fetch(cfg.dataUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = extractList(await res.json());
        if (seen < 0 || list.length < seen) {
          handlers.onInitial(list);          // أول مرة (أو لو انمسحت القائمة)
        } else {
          list.slice(seen).forEach(handlers.onNew);
        }
        seen = list.length;
      } catch (err) {
        console.warn('[Booth] تعذّر جلب الأسماء من dataUrl:', err.message);
      }
    }
    poll();
    setInterval(poll, Math.max(2, cfg.pollSeconds) * 1000);
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const withFamily = (first) => {
    const fam = window.SAMPLE_FAMILIES || [];
    return fam.length ? first + ' ' + pick(fam) : first;
  };

  function randomVisitor() {
    return { name: withFamily(pick(window.SAMPLE_NAMES)), kaust: Math.random() < 0.3 };
  }

  function startDemo(handlers) {
    const param = new URLSearchParams(location.search).get('demo');
    const count = param !== null ? Math.max(0, parseInt(param, 10) || 0) : cfg.demo.initialCount;
    const names = window.SAMPLE_NAMES;
    const list = Array.from({ length: count }, (_, i) => ({
      name: withFamily(names[i % names.length]),
      kaust: Math.random() < 0.3
    }));
    handlers.onInitial(list);
    if (param === '0') return;
    setInterval(() => handlers.onNew(randomVisitor()), Math.max(2, cfg.demo.everySeconds) * 1000);
  }

  window.BoothData = {
    demoActive: false,
    randomVisitor,
    start(handlers) {
      if (cfg.dataUrl) {
        startPolling(handlers);
      } else if (cfg.demo && cfg.demo.enabled) {
        this.demoActive = true;
        startDemo(handlers);
      } else {
        handlers.onInitial([]);
      }

      if ('BroadcastChannel' in window) {
        const ch = new BroadcastChannel('devweek-booth');
        ch.onmessage = (e) => handlers.onNew(e.data);
      }
    }
  };
})();
