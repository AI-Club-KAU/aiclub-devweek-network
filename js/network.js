/* =========================================================
   شبكة الأسماء — Canvas
   - آخر من سجّل: كرة بنفسجية كبيرة في النص
   - الخمسة الأخيرين: حدود بنفسجية + خطوط متحركة للنص
   - المشاركين في برنامج كاوست: حلقة خضراء منقّطة
   - كل اسم جديد يدفع اللي قبله للخارج، والشبكة تكبر وتصغر دوائرها حسب العدد
   ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const FONT = 'Rubik, "Segoe UI", Tahoma, sans-serif';
  const RECENT_COUNT = 5;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const now = () => performance.now() / 1000;

  class NameNetwork {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = opts.width;
      this.H = opts.height;
      this.onZoom = opts.onZoom || function () {};
      this.onPick = opts.onPick || function () {};   // لما أحد يضغط على اسم
      this.spot = null;                               // اسم قديم معروض مؤقتًا في النص (لحظة تصوير)
      this.idleReset = opts.idleResetSeconds || 20;

      // منطقة توزيع الأسماء (نترك مساحة تحت لأزرار التكبير)
      this.pad = { top: 18, right: 20, bottom: 52, left: 20 };
      this.setBounds();

      this.R = 66;              // نصف قطر الكرة اللي في النص (تتسع للاسم الكامل)
      this.RX = this.R * 1.42;  // المسافة اللي ما يدخلها أحد حول الكرة

      this.scale = 1;
      this.dpr = 1;
      this.seq = 0;
      this.nodes = [];          // الأقدم أول
      this.center = null;       // آخر من سجّل
      this.edges = [];
      this.edgesDirty = true;
      this.alpha = 0;
      this.ticks = 0;
      this.pulses = [];
      this.ripples = [];
      this.nextPulse = 0;
      this.sprites = new Map();
      this.spriteBytes = 0;
      this.hover = null;
      this.drag = null;
      this.view = { z: 1, x: 0, y: 0 };
      this.goal = { z: 1, x: 0, y: 0 };
      this.lastInteraction = now();
      this.lastT = now();

      this.particles = Array.from({ length: 46 }, () => ({
        x: (Math.random() * 2 - 1) * (this.hw + 20),
        y: (Math.random() * 2 - 1) * (this.hh + 30),
        r: 0.8 + Math.random() * 1.4,
        p: Math.random() * TAU
      }));

      this.layout();
      this.bindPointer();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    setBounds() {
      this.hw = (this.W - this.pad.left - this.pad.right) / 2;
      this.hh = (this.H - this.pad.top - this.pad.bottom) / 2;
      this.ox = this.pad.left + this.hw;
      this.oy = this.pad.top + this.hh;
    }

    /* ---------- البيانات ---------- */

    get count() { return this.nodes.length + (this.center ? 1 : 0); }

    makeNode(v) {
      return {
        id: ++this.seq,
        label: v.label,                 // الاسم الأول (داخل الدائرة)
        full: v.full || v.label,        // الاسم الكامل (يطلع لما يمر الماوس)
        kaust: !!v.kaust,
        x: 0, y: 0, vx: 0, vy: 0,
        f: 0.88 + Math.random() * 0.32,       // تنويع بسيط في الحجم
        tint: Math.random() < 0.22 ? 1 : 0,   // بعض الدوائر لونها أغمق شوي
        phase: Math.random() * TAU,
        r: 10, rc: 10, rs: 20, tw: 0
      };
    }

    makeCenter(v, animate) {
      // اللي في النص يظهر باسمه الكامل، ولما ينزاح يصير اسمه الأول بس
      return { src: v, label: v.full || v.label, kaust: !!v.kaust, born: animate ? now() : -10, tw: 0 };
    }

    // تحميل كل الأسماء مرة وحدة (بدون حركة)
    setVisitors(list) {
      this.nodes = [];
      this.center = null;
      this.spot = null;
      if (list.length) {
        this.nodes = list.slice(0, -1).map((v) => this.makeNode(v));
        this.center = this.makeCenter(list[list.length - 1], false);
      }
      this.layout();
      const N = this.nodes.length;
      this.nodes.forEach((nd, i) => {
        const rank = N - 1 - i; // الأحدث أقرب للنص
        const fr = Math.sqrt((rank + 0.5) / Math.max(N, 1));
        const a = rank * GOLDEN;
        nd.x = Math.cos(a) * (this.RX + 24 + fr * (this.hw - this.RX - 24));
        nd.y = Math.sin(a) * (this.RX * 0.9 + fr * (this.hh - this.RX * 0.9));
        nd.rc = nd.r;
      });
      this.alpha = 1;
      for (let i = 0; i < 320; i++) { this.tick(); this.alpha *= 0.985; }
      this.alpha = Math.min(this.alpha, 0.05);
      this.buildEdges();
    }

    // تسجيل شخص جديد (مع حركة)
    arrive(v) {
      const t = now();
      this.spot = null; // التسجيل الجديد ياخذ النص على طول
      if (this.center) {
        const old = this.center;
        const nd = this.makeNode(old.src);
        nd.rc = this.R * 0.95;
        nd.demote = t;
        const slot = this.findSlot();
        nd.pin = { t0: t, dur: 1.1, tx: slot.x, ty: slot.y };
        this.nodes.push(nd);
      }
      this.center = this.makeCenter(v, true);
      this.layout();
      this.alpha = Math.max(this.alpha, 0.45);
      this.edgesDirty = true;
      this.ripples.push({ t0: t + 0.1, rgb: '63, 212, 99' }, { t0: t + 0.55, rgb: '126, 54, 226' });
    }

    // عرض اسم قديم في النص مؤقتًا (بدون ما يتغير مكانه أو العدد)
    spotlight(nd) {
      if (!nd || !this.nodes.includes(nd)) return;
      const t = now();
      this.spot = { nd, obj: { label: nd.full || nd.label, tw: 0 }, born: t };
      this.ripples.push({ t0: t + 0.1, rgb: '63, 212, 99' }, { t0: t + 0.55, rgb: '126, 54, 226' });
    }

    endSpotlight() {
      if (!this.spot) return;
      this.spot = null;
      if (this.center) this.center.born = now() - 0.35; // رجعة ناعمة لآخر من سجّل
    }

    // حجم الدوائر والمسافات حسب عدد الأسماء
    layout() {
      const n = Math.max(this.nodes.length, 10);
      const area = (2 * this.hw) * (2 * this.hh) - Math.PI * this.RX * this.RX;
      this.s = Math.sqrt(area / n);
      this.baseR = clamp(this.s * 0.36, 4.5, 30);
      for (const nd of this.nodes) {
        nd.r = this.baseR * nd.f;
        nd.rs = Math.max(this.s * 0.5, nd.r * 1.22 + 1.5);
      }
    }

    // أفضل مكان يطلع له الاسم اللي كان في النص (أبعد نقطة عن الزحمة)
    findSlot() {
      const rad = this.RX + this.s * 0.5 + 6;
      let best = { x: rad, y: 0 }, bestScore = -1;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU + Math.random() * 0.25;
        const x = Math.cos(a) * rad * 1.2;
        const y = clamp(Math.sin(a) * rad * 0.9, -this.hh + 10, this.hh - 10);
        let m = Infinity;
        for (const nd of this.nodes) {
          const d = Math.hypot(nd.x - x, nd.y - y);
          if (d < m) m = d;
        }
        if (m > bestScore) { bestScore = m; best = { x, y }; }
      }
      return best;
    }

    /* ---------- الفيزياء ---------- */

    tick() {
      const nodes = this.nodes;
      const a = this.alpha;
      const t = now();
      const gy = 0.02 * a;
      const gx = gy * Math.pow(this.hh / this.hw, 2);

      // حركة الاسم اللي طالع من النص
      for (const nd of nodes) {
        if (!nd.pin) continue;
        const p = clamp((t - nd.pin.t0) / nd.pin.dur, 0, 1);
        const e = easeInOut(p);
        nd.x = nd.pin.tx * e;
        nd.y = nd.pin.ty * e;
        nd.vx = nd.vy = 0;
        if (p >= 1) nd.pin = null;
      }

      // جاذبية خفيفة للنص
      for (const nd of nodes) {
        if (nd.pin) continue;
        nd.vx -= nd.x * gx;
        nd.vy -= nd.y * gy;
      }

      // تصادم (شبكة مربعات عشان السرعة)
      const cell = this.s * 1.1;
      const grid = new Map();
      const key = (cx, cy) => cx * 8192 + cy;
      for (const nd of nodes) {
        nd.cx = Math.floor((nd.x + 4000) / cell);
        nd.cy = Math.floor((nd.y + 4000) / cell);
        const k = key(nd.cx, nd.cy);
        let b = grid.get(k);
        if (!b) grid.set(k, (b = []));
        b.push(nd);
      }
      for (const A of nodes) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const b = grid.get(key(A.cx + dx, A.cy + dy));
            if (!b) continue;
            for (const B of b) {
              if (B.id <= A.id) continue;
              let x = B.x - A.x, y = B.y - A.y;
              let d2 = x * x + y * y;
              const rs = A.rs + B.rs;
              if (d2 >= rs * rs) continue;
              if (d2 < 0.01) { x = Math.random() - 0.5; y = Math.random() - 0.5; d2 = x * x + y * y; }
              const d = Math.sqrt(d2);
              const l = ((rs - d) / d) * 0.5;
              let wa = 0.5, wb = 0.5;
              if (A.pin) { wa = 0; wb = 1; } else if (B.pin) { wa = 1; wb = 0; }
              A.vx -= x * l * wa; A.vy -= y * l * wa;
              B.vx += x * l * wb; B.vy += y * l * wb;
            }
          }
        }
      }

      // تحريك + المنطقة المحجوزة حول الكرة + حدود الإطار
      for (const nd of nodes) {
        if (nd.pin) continue;
        nd.vx *= 0.58; nd.vy *= 0.58;
        nd.x += nd.vx; nd.y += nd.vy;

        const d = Math.hypot(nd.x, nd.y) || 0.01;
        const m = this.RX + nd.r * 1.25 + 4;
        if (d < m) { nd.x *= m / d; nd.y *= m / d; }

        const lx = this.hw - nd.r * 1.15, ly = this.hh - nd.r * 1.15;
        if (nd.x > lx) { nd.x = lx; nd.vx *= -0.3; } else if (nd.x < -lx) { nd.x = -lx; nd.vx *= -0.3; }
        if (nd.y > ly) { nd.y = ly; nd.vy *= -0.3; } else if (nd.y < -ly) { nd.y = -ly; nd.vy *= -0.3; }
      }
      this.ticks++;
    }

    // كل اسم يرتبط بأقرب اسمين له
    buildEdges() {
      const nodes = this.nodes;
      const cell = this.s * 1.2;
      const grid = new Map();
      const key = (cx, cy) => cx * 8192 + cy;
      for (const nd of nodes) {
        nd.gx = Math.floor((nd.x + 4000) / cell);
        nd.gy = Math.floor((nd.y + 4000) / cell);
        const k = key(nd.gx, nd.gy);
        let b = grid.get(k);
        if (!b) grid.set(k, (b = []));
        b.push(nd);
      }
      const seen = new Set();
      const edges = [];
      const maxD = this.s * 2.2;
      for (const A of nodes) {
        const near = [];
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const b = grid.get(key(A.gx + dx, A.gy + dy));
            if (!b) continue;
            for (const B of b) {
              if (B === A) continue;
              const d = Math.hypot(B.x - A.x, B.y - A.y);
              if (d < maxD) near.push([d, B]);
            }
          }
        }
        near.sort((p, q) => p[0] - q[0]);
        for (let i = 0; i < Math.min(2, near.length); i++) {
          const B = near[i][1];
          const k = A.id < B.id ? A.id + ':' + B.id : B.id + ':' + A.id;
          if (seen.has(k)) continue;
          seen.add(k);
          edges.push([A, B]);
        }
      }
      this.edges = edges;
      this.edgesDirty = false;
    }

    /* ---------- التكبير والسحب ---------- */

    bindPointer() {
      const cv = this.canvas;

      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = this.toStage(e);
        this.zoomAt(p.x, p.y, this.goal.z * Math.exp(-e.deltaY * 0.0016));
      }, { passive: false });

      cv.addEventListener('pointerdown', (e) => {
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* بعض المتصفحات */ }
        this.drag = { x: e.clientX, y: e.clientY, gx: this.goal.x, gy: this.goal.y, moved: 0 };
        cv.classList.add('dragging');
        this.touch();
      });

      cv.addEventListener('pointermove', (e) => {
        if (this.drag) {
          const rect = cv.getBoundingClientRect();
          const k = this.W / rect.width;
          this.drag.moved = Math.max(this.drag.moved, Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y));
          this.goal.x = this.drag.gx + (e.clientX - this.drag.x) * k;
          this.goal.y = this.drag.gy + (e.clientY - this.drag.y) * k;
          this.clampGoal();
          this.view.x = this.goal.x;
          this.view.y = this.goal.y;
          this.touch();
        } else {
          this.updateHover(this.toStage(e));
        }
      });

      const end = () => { this.drag = null; cv.classList.remove('dragging'); };
      cv.addEventListener('pointerup', (e) => {
        // ضغطة بدون سحب على اسم = نعرضه في النص (لحظة تصوير)
        const click = this.drag && this.drag.moved < 6;
        end();
        if (click) {
          const hit = this.hitTest(this.toStage(e));
          if (hit) this.onPick(hit);
        }
      });
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { this.hover = null; cv.classList.remove('can-pick'); });
      cv.addEventListener('dblclick', (e) => {
        const p = this.toStage(e);
        this.zoomAt(p.x, p.y, this.goal.z * 1.8);
      });
    }

    toStage(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * this.W) / rect.width,
        y: ((e.clientY - rect.top) * this.H) / rect.height
      };
    }

    touch() { this.lastInteraction = now(); }

    zoomAt(sx, sy, z) {
      const g = this.goal;
      z = clamp(z, 1, 8);
      const wx = (sx - this.ox - g.x) / g.z;
      const wy = (sy - this.oy - g.y) / g.z;
      g.z = z;
      g.x = sx - this.ox - wx * z;
      g.y = sy - this.oy - wy * z;
      this.clampGoal();
      this.onZoom(z);
      this.touch();
    }

    zoomBy(f) { this.zoomAt(this.W / 2, this.oy, this.goal.z * f); }

    fit() {
      this.goal = { z: 1, x: 0, y: 0 };
      this.onZoom(1);
    }

    clampGoal() {
      const g = this.goal;
      if (g.z <= 1.001) { g.z = 1; g.x = 0; g.y = 0; return; }
      const mx = (this.hw + 30) * (g.z - 1);
      const my = (this.hh + 40) * (g.z - 1);
      g.x = clamp(g.x, -mx, mx);
      g.y = clamp(g.y, -my, my);
    }

    hitTest(p) {
      const v = this.view;
      const wx = (p.x - this.ox - v.x) / v.z;
      const wy = (p.y - this.oy - v.y) / v.z;
      for (const nd of this.nodes) {
        const r = nd.rc * 1.1;
        if (Math.abs(nd.px - wx) < r && Math.abs(nd.py - wy) < r && Math.hypot(nd.px - wx, nd.py - wy) < r) return nd;
      }
      return null;
    }

    updateHover(p) {
      this.hover = this.hitTest(p);
      this.canvas.classList.toggle('can-pick', !!this.hover);
    }

    /* ---------- الرسم ---------- */

    resize(scale, w, h) {
      // إذا تغيّر مقاس منطقة الشبكة نعيد توزيع الأسماء على المساحة الجديدة
      if (w && h && (Math.abs(w - this.W) > 1 || Math.abs(h - this.H) > 1)) {
        const kx = (w - this.pad.left - this.pad.right) / (this.W - this.pad.left - this.pad.right);
        const ky = (h - this.pad.top - this.pad.bottom) / (this.H - this.pad.top - this.pad.bottom);
        this.W = w; this.H = h;
        this.setBounds();
        for (const nd of this.nodes) { nd.x *= kx; nd.y *= ky; }
        for (const p of this.particles) { p.x *= kx; p.y *= ky; }
        this.layout();
        this.alpha = Math.max(this.alpha, 0.3);
        this.edgesDirty = true;
        this.clampGoal();
      }
      this.scale = scale;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.W * scale * this.dpr);
      this.canvas.height = Math.round(this.H * scale * this.dpr);
      this.sprites.clear();
      this.spriteBytes = 0;
    }

    // رسم نسخة من الشبكة بدقة عالية على canvas منفصل (لصورة نهاية اليوم)
    // تنرسم على «عرض الكل» بدون تكبير ولا فقاعة الماوس، وما تأثر على الشاشة
    renderSnapshot(scale) {
      const saved = {
        canvas: this.canvas, ctx: this.ctx, scale: this.scale, dpr: this.dpr,
        view: this.view, hover: this.hover, sprites: this.sprites, spriteBytes: this.spriteBytes
      };
      const off = document.createElement('canvas');
      off.width = Math.round(this.W * scale);
      off.height = Math.round(this.H * scale);
      this.canvas = off;
      this.ctx = off.getContext('2d');
      this.scale = scale;
      this.dpr = 1;
      this.view = { z: 1, x: 0, y: 0 };
      this.hover = null;
      this.sprites = new Map();
      this.spriteBytes = 0;
      try {
        this.draw(now());
      } finally {
        Object.assign(this, saved);
      }
      return off;
    }

    resetText() {
      for (const nd of this.nodes) { nd.tw = 0; nd.lines = null; }
      if (this.center) { this.center.tw = 0; this.center.lines = null; }
      if (this.spot) { this.spot.obj.tw = 0; this.spot.obj.lines = null; }
    }

    // تقسيم الاسم على سطرين بأفضل توازن (للكرة اللي في النص)
    splitLines(obj, weight) {
      if (obj.lines) return obj.lines;
      this.ctx.font = `${weight} 100px ${FONT}`;
      const w = (s) => Math.max(1, this.ctx.measureText(s).width / 100);
      const words = String(obj.label).split(' ').filter(Boolean);
      let best = [{ text: obj.label, w: w(obj.label) }];
      if (words.length > 1) {
        let bestMax = Infinity;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
          const wa = w(a), wb = w(b), m = Math.max(wa, wb);
          if (m < bestMax) { bestMax = m; best = [{ text: a, w: wa }, { text: b, w: wb }]; }
        }
      }
      obj.lines = best;
      return best;
    }

    measure(obj, weight) {
      if (!obj.tw) {
        this.ctx.font = `${weight} 100px ${FONT}`;
        obj.tw = Math.max(1, this.ctx.measureText(obj.label).width / 100);
      }
      return obj.tw;
    }

    frame() {
      const t = now();
      const dt = Math.min(0.05, t - this.lastT);
      this.lastT = t;

      // الفيزياء
      const pinned = this.nodes.some((nd) => nd.pin);
      if (this.alpha > 0.004 || pinned) {
        this.tick();
        this.alpha *= 0.985;
        if (this.ticks % 12 === 0) this.edgesDirty = true;
      }
      if (this.edgesDirty) this.buildEdges();

      // نعومة تغيّر الأحجام
      for (const nd of this.nodes) nd.rc += (nd.r - nd.rc) * Math.min(1, dt * 5);

      // نعومة التكبير
      const v = this.view, g = this.goal;
      const e = Math.min(1, dt * 10);
      v.z += (g.z - v.z) * e;
      v.x += (g.x - v.x) * e;
      v.y += (g.y - v.y) * e;

      // ترجع لعرض الكل بعد فترة بدون تفاعل
      if (g.z > 1 && !this.drag && t - this.lastInteraction > this.idleReset) this.fit();

      this.draw(t);
      requestAnimationFrame(this.frame);
    }

    draw(t) {
      const ctx = this.ctx;
      const k = this.scale * this.dpr;
      const v = this.view;
      const z = v.z;
      const ppw = k * z; // بكسل الشاشة لكل وحدة
      const nodes = this.nodes;
      const recent = nodes.slice(-RECENT_COUNT);
      const recentSet = new Set(recent);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(ppw, 0, 0, ppw, k * (this.ox + v.x), k * (this.oy + v.y));

      // حدود الرؤية (عشان ما نرسم اللي برا الشاشة)
      const vx0 = (-this.ox - v.x) / z - 60, vx1 = (this.W - this.ox - v.x) / z + 60;
      const vy0 = (-this.oy - v.y) / z - 60, vy1 = (this.H - this.oy - v.y) / z + 60;

      // مواقع العرض مع حركة طفو خفيفة
      for (const nd of nodes) {
        const amp = Math.min(1.8, nd.rc * 0.07);
        nd.px = nd.x + Math.sin(t * 0.55 + nd.phase) * amp;
        nd.py = nd.y + Math.cos(t * 0.45 + nd.phase * 1.3) * amp;
      }

      // نقاط خلفية
      ctx.fillStyle = 'rgba(165, 135, 230, 0.32)';
      for (const p of this.particles) {
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(t * 0.3 + p.p) * 8, p.y + Math.cos(t * 0.24 + p.p) * 6, p.r, 0, TAU);
        ctx.fill();
      }

      // الخطوط
      ctx.lineWidth = 1.1 / z;
      ctx.strokeStyle = 'rgba(160, 130, 225, 0.30)';
      ctx.beginPath();
      for (const [a, b] of this.edges) {
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
      }
      ctx.stroke();

      // خطوط الخمسة الأخيرين للنص (خرز متحرك)
      const cR = this.centerRadius(t);
      for (const nd of recent) {
        const d = Math.hypot(nd.px, nd.py) || 1;
        const ux = -nd.px / d, uy = -nd.py / d;
        const sx = nd.px + ux * nd.rc, sy = nd.py + uy * nd.rc;
        const ex = -ux * cR * 0.98, ey = -uy * cR * 0.98;
        if (d < nd.rc + cR) continue;
        ctx.setLineDash([]);
        ctx.lineWidth = 1.4 / z;
        ctx.strokeStyle = 'rgba(126, 54, 226, 0.28)';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([0.001, 9]);
        ctx.lineDashOffset = -t * 14;
        ctx.lineCap = 'round';
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = '#8b47ee';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';

      // نبضات خضراء تمشي على الخطوط
      this.updatePulses(t, recent);
      for (const p of this.pulses) {
        const u = easeInOut(clamp((t - p.t0) / p.dur, 0, 1));
        const ax = p.a ? p.a.px : 0, ay = p.a ? p.a.py : 0;
        const bx = p.b ? p.b.px : 0, by = p.b ? p.b.py : 0;
        const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
        const fade = Math.sin(Math.PI * clamp((t - p.t0) / p.dur, 0, 1));
        ctx.fillStyle = `rgba(47, 158, 69, ${0.18 * fade})`;
        ctx.beginPath(); ctx.arc(x, y, 7 / z, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(47, 158, 69, ${fade})`;
        ctx.beginPath(); ctx.arc(x, y, 3.2 / z, 0, TAU); ctx.fill();
      }

      // الدوائر والأسماء
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const nd of nodes) {
        if (nd.px < vx0 || nd.px > vx1 || nd.py < vy0 || nd.py > vy1) continue;
        const r = nd.rc * (nd === this.hover ? 1.12 : 1);
        this.drawNode(ctx, nd, r, recentSet.has(nd) ? 'recent' : 'visitor', ppw, t, z);

        // الاسم اللي كان في النص يتحول تدريجيًا من كرة بنفسجية لدائرة عادية
        if (nd.demote) {
          const p = (t - nd.demote) / 0.9;
          if (p >= 1) nd.demote = 0;
          else this.drawSphere(ctx, nd.px, nd.py, r, nd, 1 - easeInOut(clamp(p, 0, 1)), false, z, t);
        }
      }

      // لحظة تصوير: حلقة تنبض حول مكان الاسم الأصلي + خط يوصله بالنص
      if (this.spot) this.drawSpotLink(ctx, t, z, cR);

      // الكرة اللي في النص
      this.drawCenter(ctx, t, z, cR);

      // موجات التسجيل الجديد
      this.ripples = this.ripples.filter((rp) => t - rp.t0 < 1.8);
      for (const rp of this.ripples) {
        const u = (t - rp.t0) / 1.8;
        if (u < 0) continue;
        ctx.strokeStyle = `rgba(${rp.rgb || '126, 54, 226'}, ${0.5 * (1 - u)})`;
        ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.arc(0, 0, this.R * (1 + u * 2.6), 0, TAU); ctx.stroke();
      }

      // اسم واضح فوق الدائرة لما يمر عليها الماوس
      if (this.hover) this.drawTooltip(ctx, this.hover, k, z);
    }

    drawSpotLink(ctx, t, z, cR) {
      const nd = this.spot.nd;
      const d = Math.hypot(nd.px, nd.py) || 1;
      const ux = -nd.px / d, uy = -nd.py / d;
      ctx.save();
      ctx.setLineDash([2, 8]);
      ctx.lineDashOffset = -t * 18;
      ctx.lineCap = 'round';
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = 'rgba(47, 158, 69, 0.75)';
      ctx.beginPath();
      ctx.moveTo(nd.px + ux * nd.rc * 1.2, nd.py + uy * nd.rc * 1.2);
      ctx.lineTo(-ux * cR, -uy * cR);
      ctx.stroke();
      ctx.setLineDash([]);
      const pulse = (t * 1.2) % 1;
      ctx.lineWidth = 2.5 / z;
      ctx.strokeStyle = `rgba(63, 212, 99, ${0.9 * (1 - pulse)})`;
      ctx.beginPath(); ctx.arc(nd.px, nd.py, nd.rc * (1.15 + pulse * 0.6), 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#2f9e45';
      ctx.beginPath(); ctx.arc(nd.px, nd.py, nd.rc * 1.12, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    centerRadius(t) {
      if (!this.center && !this.spot) return this.R;
      const born = this.spot ? this.spot.born : this.center.born;
      const pop = easeOutBack(clamp((t - born) / 0.9, 0, 1));
      return this.R * Math.max(0.001, pop) * (1 + Math.sin(t * 1.6) * 0.012);
    }

    updatePulses(t, recent) {
      this.pulses = this.pulses.filter((p) => t - p.t0 < p.dur);
      if (t < this.nextPulse || this.pulses.length > 8) return;
      this.nextPulse = t + 0.55 + Math.random() * 0.5;
      if (recent.length && this.center && Math.random() < 0.35) {
        const nd = recent[Math.floor(Math.random() * recent.length)];
        this.pulses.push({ a: nd, b: null, t0: t, dur: 1.3 });
      } else if (this.edges.length) {
        const [a, b] = this.edges[Math.floor(Math.random() * this.edges.length)];
        this.pulses.push(Math.random() < 0.5 ? { a, b, t0: t, dur: 1.6 } : { a: b, b: a, t0: t, dur: 1.6 });
      }
    }

    drawNode(ctx, nd, r, kind, ppw, t, z) {
      const pr = r * ppw;
      if (pr > 150) {
        // تكبير كبير: نرسم مباشرة بدل الصورة الجاهزة
        ctx.save();
        ctx.translate(nd.px, nd.py);
        paintNode(ctx, r, kind, nd.kaust, nd.tint, 1 / ppw);
        ctx.restore();
      } else {
        const sp = this.sprite(kind, nd.kaust, nd.tint, pr);
        const size = sp.width / ppw;
        ctx.drawImage(sp, nd.px - size / 2, nd.py - size / 2, size, size);
      }

      // نقطة خضراء تدور حول المشاركين في كاوست
      if (nd.kaust && pr > 6) {
        const a = t * 0.7 + nd.phase;
        ctx.fillStyle = '#2f9e45';
        ctx.beginPath();
        ctx.arc(nd.px + Math.cos(a) * r * 1.3, nd.py + Math.sin(a) * r * 1.3, Math.max(r * 0.09, 1.3 / z), 0, TAU);
        ctx.fill();
      }

      // الاسم
      const tw = this.measure(nd, 700);
      const fs = Math.min(r * 0.46, (r * 1.6) / tw);
      if (fs * ppw < 3.5) return;
      ctx.font = `700 ${fs}px ${FONT}`;
      ctx.fillStyle = '#1e1240';
      ctx.fillText(nd.label, nd.px, nd.py + fs * 0.06);
    }

    drawCenter(ctx, t, z, R) {
      if (this.spot) {
        // اسم قديم معروض مؤقتًا: نفس شكل الكرة، ونرسم اسمه بداله
        const s = this.spot;
        const c = s.obj;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t * 6;
        ctx.lineWidth = 1.3 / z;
        ctx.strokeStyle = s.nd.kaust ? 'rgba(47, 158, 69, 0.85)' : 'rgba(126, 54, 226, 0.30)';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.36, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        this.drawSphere(ctx, 0, 0, R, c, 1, true, z, t);
        return;
      }
      if (!this.center) {
        // ما فيه أحد سجّل للحين
        if (!this.emptyLabel) this.emptyLabel = { label: 'كن الأول!', tw: 0 };
        this.drawSphere(ctx, 0, 0, this.R, this.emptyLabel, 1, false, z, t);
        return;
      }
      const c = this.center;

      // حلقة منقطة حول الكرة
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -t * 6;
      ctx.lineWidth = 1.3 / z;
      ctx.strokeStyle = c.kaust ? 'rgba(47, 158, 69, 0.85)' : 'rgba(126, 54, 226, 0.30)';
      ctx.beginPath(); ctx.arc(0, 0, R * 1.36, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);

      this.drawSphere(ctx, 0, 0, R, c, 1, true, z, t);

      if (c.kaust) {
        const a = t * 0.8;
        ctx.fillStyle = '#2f9e45';
        ctx.beginPath(); ctx.arc(Math.cos(a) * R * 1.36, Math.sin(a) * R * 1.36, 5, 0, TAU); ctx.fill();
      }
    }

    drawSphere(ctx, x, y, R, obj, alpha, glow, z, t) {
      if (R < 1 || alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (glow) {
        const g = ctx.createRadialGradient(x, y, R * 0.7, x, y, R * 1.9);
        g.addColorStop(0, 'rgba(126, 54, 226, 0.30)');
        g.addColorStop(1, 'rgba(126, 54, 226, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R * 1.9, 0, TAU); ctx.fill();
      }

      // تدرّج أخضر ← بنفسجي (نفس ألوان شعار النادي)
      const b = ctx.createLinearGradient(x + R * 0.35, y - R, x - R * 0.35, y + R);
      b.addColorStop(0, '#3fd463');
      b.addColorStop(0.18, '#36b98a');
      b.addColorStop(0.5, '#8a45ee');
      b.addColorStop(1, '#6420d0');
      ctx.fillStyle = b;
      ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();

      // لمعة
      ctx.save();
      ctx.translate(x - R * 0.3, y - R * 0.58);
      ctx.rotate(-0.32);
      ctx.scale(1, 0.42);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.33)';
      ctx.beginPath(); ctx.arc(0, 0, R * 0.3, 0, TAU); ctx.fill();
      ctx.restore();

      // الاسم: سطر واحد، أو سطرين إذا كان طويل (الاسم الكامل)
      const one = this.measure(obj, 800);
      let lines = [{ text: obj.label, w: one }];
      let fs = Math.min(R * 0.5, (R * 1.5) / one);
      if (fs < R * 0.36) {
        const two = this.splitLines(obj, 800);
        if (two.length > 1) {
          const fs2 = Math.min(R * 0.4, (R * 1.42) / Math.max(two[0].w, two[1].w));
          if (fs2 > fs) { fs = fs2; lines = two; }
        }
      }
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${fs}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(40, 10, 90, 0.35)';
      ctx.shadowBlur = fs * 0.25;
      const lh = fs * 1.12;
      const y0 = y + fs * 0.05 - (lh * (lines.length - 1)) / 2;
      lines.forEach((ln, i) => ctx.fillText(ln.text, x, y0 + i * lh));
      ctx.restore();
    }

    drawTooltip(ctx, nd, k, z) {
      const v = this.view;
      const sx = this.ox + v.x + nd.px * z;
      const sy = this.oy + v.y + (nd.py - nd.rc * 1.15) * z - 10;
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const text = nd.full || nd.label;
      ctx.font = `700 16px ${FONT}`;
      ctx.direction = 'rtl';
      const w = ctx.measureText(text).width + 26;
      const h = 32;
      const x = clamp(sx - w / 2, 4, this.W - w - 4);
      const y = Math.max(4, sy - h);
      ctx.fillStyle = '#1e1240';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.fillStyle = '#3fd463';
      ctx.beginPath(); ctx.arc(x + w / 2, y + h + 3, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + 1);
      ctx.restore();
    }

    // صور جاهزة للدوائر (أسرع بكثير من رسم الظل كل مرة)
    sprite(kind, kaust, tint, pr) {
      const q = pr < 20 ? Math.round(pr * 2) / 2 : Math.round(pr);
      const key = kind + (kaust ? 'k' : '') + tint + ':' + q;
      let sp = this.sprites.get(key);
      if (sp) return sp;
      if (this.spriteBytes > 64e6) { this.sprites.clear(); this.spriteBytes = 0; }
      const ext = Math.max(q * 1.62, q * 1.3 + 3) + 2;
      const size = Math.ceil(ext * 2);
      sp = document.createElement('canvas');
      sp.width = sp.height = size;
      const g = sp.getContext('2d');
      g.translate(size / 2, size / 2);
      paintNode(g, q, kind, kaust, tint, 1);
      this.sprites.set(key, sp);
      this.spriteBytes += size * size * 4;
      return sp;
    }
  }

  // رسم دائرة اسم واحدة حول النقطة (0,0) بنصف قطر r. px = حجم البكسل بنفس الوحدة
  function paintNode(g, r, kind, kaust, tint, px) {
    // توهج خفيف
    const glow = g.createRadialGradient(0, r * 0.12, r * 0.7, 0, r * 0.12, r * 1.6);
    glow.addColorStop(0, 'rgba(126, 54, 226, 0.15)');
    glow.addColorStop(1, 'rgba(126, 54, 226, 0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, r * 0.12, r * 1.6, 0, TAU); g.fill();

    // الجسم
    const body = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.62, tint ? '#f5effe' : '#fdfbff');
    body.addColorStop(1, tint ? '#e4d6fc' : '#efe7fd');
    g.fillStyle = body;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();

    // الحدود
    const recent = kind === 'recent';
    const lw = recent ? Math.max(1.5 * px, r * 0.075) : Math.max(1 * px, r * 0.035);
    g.lineWidth = lw;
    g.strokeStyle = recent ? '#7e36e2' : 'rgba(186, 160, 240, 0.65)';
    g.beginPath(); g.arc(0, 0, r - lw / 2, 0, TAU); g.stroke();

    // حلقة كاوست
    if (kaust) {
      g.setLineDash([Math.max(2 * px, r * 0.11), Math.max(2 * px, r * 0.09)]);
      g.lineWidth = Math.max(1 * px, r * 0.04);
      g.strokeStyle = 'rgba(47, 158, 69, 0.85)';
      g.beginPath(); g.arc(0, 0, r * 1.3, 0, TAU); g.stroke();
      g.setLineDash([]);
    }
  }

  window.NameNetwork = NameNetwork;
})();
