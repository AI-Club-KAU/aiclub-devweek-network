/* =========================================================
   تشغيل الشاشة: التاريخ، الباركود، الشبكة، العدّاد، والترحيب
   ========================================================= */
(function () {
  'use strict';

  const cfg = window.BOOTH_CONFIG;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const toAr = (n) => Number(n).toLocaleString('ar-SA-u-nu-arab', { maximumFractionDigits: 1 });

  /* ---------- تكبير اللوحة على مقاس الشاشة ---------- */
  let network = null;
  // التصميم أساسه 1440×810، لكن إذا الشاشة أطول أو أعرض من 16:9
  // نمدّ اللوحة عشان تعبّي الشاشة كلها (والشبكة تاخذ المساحة الزايدة)
  function fitStage() {
    const iw = window.innerWidth, ih = window.innerHeight;
    const s = Math.min(iw / 1440, ih / 810);
    stage.style.setProperty('--s', s);
    stage.style.setProperty('--w', Math.max(1440, iw / s) + 'px');
    stage.style.setProperty('--h', Math.max(810, ih / s) + 'px');
    if (network) {
      const graph = $('#graph');
      network.resize(s, graph.offsetWidth, graph.offsetHeight);
    }
    fitWelcome();
  }

  /* ---------- التاريخ (يتحدّث تلقائيًا) ---------- */
  function renderDate() {
    const parts = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    $('#today').textContent = `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
  }

  /* ---------- تجهيز الاسم للعرض ---------- */
  const blocked = (cfg.blockedWords || []).map((w) => String(w).trim()).filter(Boolean);
  const truthy = (v) => v === true || v === 1 || /^(true|yes|y|1|نعم|مشارك|مشاركة)$/i.test(String(v == null ? '' : v).trim());

  // الاسم الأول فقط (مع دمج «عبد ...» و «أبو ...»)
  function firstName(full) {
    const parts = String(full).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return '';
    let first = parts[0];
    if (first === 'عبد' && parts[1]) first += parts[1];
    else if (/^(أبو|ابو)$/.test(first) && parts[1]) first += ' ' + parts[1];
    return first.length > 14 ? first.slice(0, 13) + '…' : first;
  }

  function normalize(item) {
    if (item == null) return null;
    const obj = typeof item === 'string' ? { name: item } : item;
    const name = String(obj.name ?? obj['الاسم'] ?? obj.fullName ?? obj.full_name ?? '').trim();
    if (!name) return null;
    if (blocked.some((w) => name.includes(w))) return null;
    const kaust = truthy(obj.kaust ?? obj.isKaust ?? obj.kaustParticipant ?? obj.participant ?? obj['مشارك']);
    // تاريخ التسجيل yyyy-MM-dd (من الشيت). لو ما فيه (وضع التجربة) = اليوم
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.date || '')) ? String(obj.date) : todayKey();
    return { name, label: firstName(name), full: fullName(name), kaust, date };
  }

  function todayKey() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // تواريخ كل اللي في الشبكة (لصورة الشبكة: من … إلى … ، وكم سجّل اليوم)
  let visitorDates = [];

  function fmtDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(y, m - 1, d));
  }

  // الاسم الكامل للعرض (آخر من سجّل + لما يمر الماوس على الاسم)
  function fullName(full) {
    const s = String(full).trim().replace(/\s+/g, ' ');
    return s.length > 40 ? s.slice(0, 39) + '…' : s;
  }

  /* ---------- الترحيب والعدّاد ---------- */
  let shownCount = 0;
  function setCount(n, animate) {
    const el = $('#count');
    const from = shownCount;
    shownCount = n;
    if (!animate) { el.textContent = toAr(n); return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / 700));
      el.textContent = toAr(Math.round(from + (n - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  function setWelcome(v, animate) {
    const el = $('#latestName');
    el.textContent = v ? v.full : 'بكم';
    fitWelcome();
    if (animate) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
  }

  // نصغّر خط الترحيب إذا الاسم الكامل طويل عشان ما يطلع برا مكانه
  function fitWelcome() {
    const box = $('.welcome__name');
    box.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(box).fontSize);
    while (box.scrollWidth > box.clientWidth && fs > 24) {
      fs -= 2;
      box.style.fontSize = fs + 'px';
    }
  }

  /* ---------- طابور التسجيلات الجديدة ----------
     لو سجّل أكثر من شخص بنفس الوقت ما أحد يغطي على الثاني:
     كل اسم ياخذ دوره في النص، واللي بعده يظهرون في «وبعده: ...» */
  const queue = [];
  let busy = false;

  function renderNextUp() {
    const el = $('#nextUp');
    if (!queue.length) { el.hidden = true; return; }
    const names = queue.slice(0, 2).map((v) => v.label);
    const more = queue.length - names.length;
    el.textContent = ' · وبعده: ' + names.join('، ') + (more > 0 ? ` +${toAr(more)}` : '');
    el.hidden = false;
  }

  /* ---------- لحظة تصوير ----------
     الضغط على أي اسم في الشبكة يعرضه في النص مؤقتًا (لو فاته يصوّر)،
     بدون ما يتغير مكانه أو العدّاد أو يدخل الطابور */
  let latestVisitor = null;
  let spotTimer = null;

  function spotlight(nd) {
    clearTimeout(spotTimer);
    network.spotlight(nd);
    setWelcome({ full: nd.full || nd.label }, true);
    spotTimer = setTimeout(endSpotlight, (cfg.spotlightSeconds || 10) * 1000);
  }

  function endSpotlight(silent) {
    if (!spotTimer) return;
    clearTimeout(spotTimer);
    spotTimer = null;
    network.endSpotlight();
    if (!silent) setWelcome(latestVisitor, true);
  }

  function pump() {
    if (busy || !queue.length) { renderNextUp(); return; }
    const v = queue.shift();
    busy = true;
    endSpotlight(true); // التسجيل الجديد ياخذ النص على طول
    latestVisitor = v;
    network.arrive(v);
    setWelcome(v, true);
    setCount(network.count, true);
    renderNextUp();
    // لو تجمّعت أسماء كثيرة نسرّع شوي، بس كل اسم ياخذ وقت كافي يشوفه صاحبه
    const wait = queue.length > 3 ? (cfg.busyWelcomeSeconds || 2.5) : cfg.welcomeSeconds;
    setTimeout(() => { busy = false; pump(); }, wait * 1000);
  }

  function addVisitor(item) {
    const v = normalize(item);
    if (!v || !network) return;
    visitorDates.push(v.date);
    queue.push(v);
    pump();
  }

  function loadInitial(items) {
    const list = items.map(normalize).filter(Boolean);
    visitorDates = list.map((v) => v.date);
    queue.length = 0;
    renderNextUp();
    endSpotlight(true);
    network.setVisitors(list);
    latestVisitor = list[list.length - 1] || null;
    setWelcome(latestVisitor, false);
    setCount(network.count, false);
  }

  /* ---------- صورة الشبكة لنهاية اليوم ---------- */
  let snapping = false;
  async function takeSnapshot() {
    if (snapping || !window.BoothSnapshot) return;
    snapping = true;
    const btn = $('#snapBtn');
    btn.classList.add('busy');
    try {
      const today = todayKey();
      const first = visitorDates.length ? visitorDates.reduce((a, b) => (b < a ? b : a)) : today;
      await window.BoothSnapshot.download({
        network,
        count: network.count,
        todayCount: visitorDates.filter((d) => d === today).length,
        dateText: first < today ? `من ${fmtDay(first)} إلى ${fmtDay(today)}` : fmtDay(today)
      });
    } finally {
      btn.classList.remove('busy');
      snapping = false;
    }
  }

  /* ---------- أزرار ولوحة المفاتيح ---------- */
  function bindControls() {
    $('#snapBtn').addEventListener('click', takeSnapshot);

    $('.graph__controls').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'zoom-in') network.zoomBy(1.5);
      else if (a === 'zoom-out') network.zoomBy(1 / 1.5);
      else if (a === 'fit') network.fit();
    });

    // نستخدم e.code (مكان الزر) عشان الاختصارات تشتغل حتى لو الكيبورد عربي
    document.addEventListener('keydown', (e) => {
      const code = e.code;
      const key = e.key.toLowerCase();
      if (code === 'KeyF') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      } else if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') network.zoomBy(1.5);
      else if (key === '-' || code === 'Minus' || code === 'NumpadSubtract') network.zoomBy(1 / 1.5);
      else if (key === 'escape') { endSpotlight(); network.fit(); }
      else if (code === 'Digit0' || code === 'Numpad0') network.fit();
      else if (code === 'KeyS') takeSnapshot();
      else if (code === 'KeyN' && window.BoothData.demoActive) addVisitor(window.BoothData.randomVisitor());
    });

    // إخفاء الماوس بعد ٣ ثواني بدون حركة
    let idleTimer;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
    };
    document.addEventListener('pointermove', wake);
    wake();
  }

  /* ---------- التشغيل ---------- */
  async function start() {
    fitStage();
    window.addEventListener('resize', fitStage);

    renderDate();
    setInterval(renderDate, 60 * 1000);

    renderQR($('#qr'), cfg.registrationUrl);
    if (/example\.com/i.test(cfg.registrationUrl)) {
      console.warn('[Booth] رابط الباركود ما زال تجريبي — غيّروه من js/config.js');
    }

    // ننتظر الخط عشان الأسماء تنرسم صح
    try {
      await Promise.race([
        Promise.all([document.fonts.load(`700 20px Rubik`, 'سارة'), document.fonts.load(`800 20px Rubik`, 'سارة')]),
        new Promise((r) => setTimeout(r, 2500))
      ]);
    } catch (e) { /* نكمل بالخط الاحتياطي */ }

    const graph = $('#graph');
    network = new NameNetwork($('#network'), {
      width: graph.offsetWidth,
      height: graph.offsetHeight,
      idleResetSeconds: cfg.idleResetSeconds,
      onPick: (nd) => spotlight(nd),
      loading: !!cfg.dataUrl, // مع الشيت: نقاط تحميل لين توصل الأسماء
      onZoom: (z) => { $('#zoomLevel').textContent = '×' + toAr(Math.round(z * 10) / 10); }
    });
    fitStage();
    document.fonts.ready.then(() => { network.resetText(); fitWelcome(); });

    bindControls();

    // واجهة الربط
    window.Booth = {
      addVisitor,
      setVisitors: loadInitial,
      get count() { return network.count; }
    };

    window.BoothData.start({ onInitial: loadInitial, onNew: addVisitor });
  }

  start();
})();
