
const PAPERS = { '4R': { label: '4R', w: 101.6, h: 152.4, dim: '4 × 6 in' }, A4: { label: 'A4', w: 210, h: 297, dim: '210 × 297 mm' }, short: { label: 'Short bond', w: 215.9, h: 279.4, dim: '8.5 × 11 in' }, long: { label: 'Long bond', w: 215.9, h: 330.2, dim: '8.5 × 13 in' } };
const PORDER = ['4R', 'A4', 'short', 'long'];
const SIZES = { '1x1': { label: '1x1', w: 25.4, h: 25.4, crown: .10, cmin: .70, cmax: .80 }, '2x2': { label: '2x2', w: 50.8, h: 50.8, crown: .12, cmin: .64, cmax: .74 }, passport: { label: 'Passport', w: 35, h: 45, crown: .08, cmin: .78, cmax: .87 } };
const BGS = [{ k: 'white', label: 'White', hex: '#FFFFFF' }, { k: 'blue', label: 'Blue', hex: '#1E5BC6' }, { k: 'lblue', label: 'Light blue', hex: '#8EC5FF' }, { k: 'red', label: 'Red', hex: '#C62828' }, { k: 'gray', label: 'Light gray', hex: '#E9E9E9' }];
const STEPS = ['Import', 'Adjust', 'Background', 'Print sheet', 'Export'];
const NEXT = ['Next: Adjust', 'Next: Background', 'Next: Print sheet', 'Next: Export', 'New photo'];
const SAVED = [{ label: '4R Combo: 2 pcs 2x2 + 4 pcs 1x1', paper: '4R', rows: [['2x2', 2], ['1x1', 4]] }, { label: 'Student set: 2 pcs 2x2 + 6 pcs 1x1', paper: '4R', rows: [['2x2', 2], ['1x1', 6]] }, { label: 'Passport pack: 6 pcs Passport', paper: '4R', rows: [['passport', 6]] }];
const HIST = ['preset', 'zoom', 'rot', 'bg', 'customHex', 'bright', 'contrast', 'warmth', 'edge', 'hair', 'customW', 'customH'];
const trim = (v, d) => String(+v.toFixed(d));

class Component extends DCLogic {
  state = { step: 0, maxStep: 0, phase: 'empty', prog: 0, preset: '2x2', customW: 40, customH: 50, unit: 'mm', zoom: 100, rot: 0, levelEyes: true, facePicked: false, bg: 'white', customHex: '#D9E4DD', edge: 0, hair: 60, bright: 0, contrast: 0, warmth: 0, adjOpen: false, tagOpen: false, tagOn: false, tagText: 'Juan Dela Cruz', split: 50, viewZoom: 1, compareHeld: false, paper: '4R', mode: 'fill', qty: 4, rows: [['2x2', 2], ['1x1', 4]], cutMarks: true, orient: 'auto', savedVal: '', toast: null, printing: false, settingsOpen: false, tab: 'defaults', hd: 'none', hdProg: 0, quality: 'standard', past: [], future: [], vw: 1600, vh: 900 };
  cropRef = React.createRef(); cmpRef = React.createRef();

  componentDidMount() {
    this.onResize = () => this.setState({ vw: window.innerWidth, vh: window.innerHeight });
    this.onResize(); window.addEventListener('resize', this.onResize);
    this.onMove = (e) => this.handleDrag(e); this.onUp = () => { this.drag = null; };
    window.addEventListener('mousemove', this.onMove); window.addEventListener('mouseup', this.onUp);
    this.onKey = (e) => this.handleKey(e, true); this.onKeyUp = (e) => this.handleKey(e, false);
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKeyUp);
    this.timer = setInterval(() => this.tick(), 60);
    this.applyScenario();
  }
  componentWillUnmount() {
    window.removeEventListener('resize', this.onResize); window.removeEventListener('mousemove', this.onMove); window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); clearInterval(this.timer);
  }
  componentDidUpdate(prev) { if (prev.scenario !== this.props.scenario) this.applyScenario(); }

  applyScenario() {
    const sc = this.props.scenario || 'None';
    if (sc === 'Unsupported file') this.setState({ step: 0, maxStep: 0, phase: 'unsupported', settingsOpen: false });
    else if (['No face found', 'Multiple faces', 'Low resolution'].includes(sc)) this.setState(s => ({ step: 1, maxStep: Math.max(1, s.maxStep), phase: 'done', facePicked: false, settingsOpen: false }));
    else if (sc === 'Download failed') this.setState({ settingsOpen: true, tab: 'models', hd: 'failed', hdProg: 0.42 });
    else if (sc === 'Checksum mismatch') this.setState({ settingsOpen: true, tab: 'models', hd: 'mismatch', hdProg: 1 });
    else if (sc === "Doesn't fit on paper") this.setState({ step: 3, maxStep: 4, phase: 'done', mode: 'package', paper: '4R', rows: [['2x2', 4], ['1x1', 6]], settingsOpen: false });
    else if (sc === 'Export failure') this.setState({ step: 4, maxStep: 4, phase: 'done', settingsOpen: false });
  }

  tick() {
    const s = this.state;
    if (s.phase === 'processing') {
      const p = s.prog + 0.016;
      if (p >= 1) this.setState(st => ({ phase: 'done', prog: 1, step: 1, maxStep: Math.max(1, st.maxStep), viewZoom: 1 }));
      else this.setState({ prog: p });
    }
    if (s.hd === 'downloading') {
      const p = s.hdProg + 0.006;
      this.setState(p >= 1 ? { hd: 'installed', hdProg: 1 } : { hdProg: p });
    }
  }

  handleKey(e, down) {
    const t = e.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.key === '\\' && !typing) { if (this.state.compareHeld !== down) this.setState({ compareHeld: down }); return; }
    if (!down) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === 'Escape' && this.state.settingsOpen) return this.setState({ settingsOpen: false });
    if (c && k === 'z') { e.preventDefault(); return this.undo(); }
    if (c && k === 'y') { e.preventDefault(); return this.redo(); }
    if (c && k === 'n') { e.preventDefault(); return this.newPhoto(); }
    if (c && (k === 'o' || k === 'v') && this.state.step === 0) { e.preventDefault(); return this.startImport(); }
    if (c && k === 'p' && this.state.step === 4) { e.preventDefault(); return this.doPrint(); }
    if (c && e.key === 'ArrowLeft') { e.preventDefault(); return this.back(); }
    if ((c && e.key === 'ArrowRight') || (e.key === 'Enter' && !typing && t.tagName !== 'BUTTON')) { e.preventDefault(); return this.next(); }
  }

  handleDrag(e) {
    if (!this.drag) return;
    if (this.drag === 'split') {
      const el = this.cmpRef.current; if (!el) return; const r = el.getBoundingClientRect();
      return this.setState({ split: Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) });
    }
    const el = this.cropRef.current; if (!el) return; const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height, g = this.geom();
    const z = this.drag === 'chin' ? (y - g.eye) / (g.cmid - g.eye) : (g.eye - y) / (g.eye - g.crown);
    this.set({ zoom: Math.round(Math.max(60, Math.min(150, z * 100))) }, 'drag');
  }

  set(patch, key) {
    const now = Date.now();
    this.setState(s => {
      const coalesce = key && key === this.lastKey && now - this.lastT < 900;
      const snap = {}; HIST.forEach(k => { snap[k] = s[k]; });
      return { ...patch, past: coalesce ? s.past : [...s.past.slice(-49), snap], future: [] };
    });
    this.lastKey = key; this.lastT = now;
  }
  undo() { this.setState(s => { if (!s.past.length) return null; const snap = {}; HIST.forEach(k => { snap[k] = s[k]; }); return { ...s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [...s.future, snap] }; }); this.lastKey = null; }
  redo() { this.setState(s => { if (!s.future.length) return null; const snap = {}; HIST.forEach(k => { snap[k] = s[k]; }); return { ...s.future[s.future.length - 1], future: s.future.slice(0, -1), past: [...s.past, snap] }; }); this.lastKey = null; }

  geom(key) {
    const k = key || this.state.preset;
    const b = k === 'custom' ? { ...SIZES['2x2'], label: 'Custom', w: this.state.customW, h: this.state.customH } : SIZES[k];
    const cmid = (b.cmin + b.cmax) / 2;
    return { ...b, cmid, eye: b.crown + 0.47 * (cmid - b.crown), aspect: b.w / b.h };
  }
  headAt(g, z) { return { crown: g.eye - (g.eye - g.crown) * z, chin: g.eye + (g.cmid - g.eye) * z }; }

  startImport() { this.setState({ phase: 'processing', prog: 0, step: 0 }); }
  go(i) { this.setState({ step: i, viewZoom: 1, toast: null }); }
  next() { const s = this.state; if (s.step === 0) { if (s.phase === 'done') this.go(1); return; } if (s.step === 4) return this.newPhoto(); this.setState(st => ({ step: st.step + 1, maxStep: Math.max(st.maxStep, st.step + 1), viewZoom: 1, toast: null })); }
  back() { if (this.state.step > 0) this.go(this.state.step - 1); }
  newPhoto() { this.setState({ step: 0, maxStep: 0, phase: 'empty', prog: 0, zoom: 100, rot: 0, facePicked: false, toast: null, viewZoom: 1, split: 50, past: [], future: [], tagOn: false }); }
  doPrint() {
    if (this.state.printing) return;
    this.setState({ printing: true, toast: null });
    setTimeout(() => {
      const fail = this.props.scenario === 'Export failure';
      this.setState({ printing: false, toast: fail ? { kind: 'err', title: 'Couldn’t save the sheet', body: 'The folder D:\\Exports isn’t writable. Choose another export folder, then try again.' } : { kind: 'ok', title: 'Sheet opened in PDF viewer', body: 'Saved to Documents\\ID Photos\\2026-09-24_' + this.geom().label.toLowerCase() + '_001.pdf' } });
    }, 900);
  }

  items() {
    const s = this.state; const mk = (k) => { const g = this.geom(k); return { k, w: g.w, h: g.h }; };
    if (s.mode === 'fill') return { list: Array.from({ length: 400 }, () => mk(s.preset)), stop: true };
    if (s.mode === 'exact') return { list: Array.from({ length: s.qty }, () => mk(s.preset)), stop: false };
    const list = []; s.rows.forEach(([k, q]) => { for (let i = 0; i < q; i++) list.push(mk(k)); });
    list.sort((a, b) => b.h - a.h); return { list, stop: false };
  }
  pack(items, pw, ph, stop) {
    const m = 5, gp = 2, e = 1e-6; let x = m, y = m, rh = 0, miss = 0; const out = [];
    for (const it of items) {
      if (x > m && x + it.w > pw - m + e) { x = m; y += rh + gp; rh = 0; }
      if (x + it.w > pw - m + e || y + it.h > ph - m + e) { miss++; if (stop) break; continue; }
      out.push({ ...it, x, y }); x += it.w + gp; rh = Math.max(rh, it.h);
    }
    if (out.length) { const maxX = Math.max(...out.map(o => o.x + o.w)); const dx = (pw - m - maxX) / 2; out.forEach(o => { o.x += dx; }); }
    return { out, miss, pw, ph };
  }
  layout(paperKey) {
    const s = this.state, p = PAPERS[paperKey], { list, stop } = this.items();
    const a = { ...this.pack(list, p.w, p.h, stop), land: false }, b = { ...this.pack(list, p.h, p.w, stop), land: true };
    if (s.orient === 'portrait') return a; if (s.orient === 'landscape') return b;
    if (s.mode === 'fill') return b.out.length > a.out.length ? b : a;
    return b.miss < a.miss ? b : a;
  }

  renderVals() {
    const P = this.props, S = this.state;
    const [W, H] = String(P.frame || '').includes('1366') ? [1366, 768] : [1920, 1080];
    const sc = P.scenario || 'None';
    const step = S.step, hasPanel = step > 0;
    const cW = W - (hasPanel ? 360 : 0), cH = H - 64 - 76;
    const g = this.geom(), z = S.zoom / 100, hd = this.headAt(g, z);
    const noFace = sc === 'No face found' && step === 1, multi = sc === 'Multiple faces', lowRes = sc === 'Low resolution' && step === 1;
    const bgObj = BGS.find(b => b.k === S.bg), bgHex = bgObj ? bgObj.hex : S.customHex;
    const bgLabel = bgObj ? bgObj.label : 'Custom ' + S.customHex.toUpperCase();
    const status = noFace ? 'manual' : hd.chin < g.cmin ? 'small' : (hd.chin > g.cmax || hd.crown < 0.02) ? 'large' : 'ok';
    const gc = status === 'ok' ? 'var(--ok-line)' : status === 'manual' ? 'var(--color-accent)' : 'var(--warn-line)';
    const sizeText = `${trim(g.w, 1)} × ${trim(g.h, 1)} mm · ${trim(g.w / 25.4, 2)} × ${trim(g.h / 25.4, 2)} in`;
    const isPassport = S.preset === 'passport';
    const tagShown = S.tagOn && !isPassport ? S.tagText.toUpperCase() : '';
    const wm = S.warmth;
    const photoFilter = `brightness(${1 + S.bright / 100}) contrast(${1 + S.contrast / 100})${wm > 0 ? ` sepia(${wm / 180})` : wm < 0 ? ` hue-rotate(${wm * 0.4}deg) saturate(${1 + wm / 200})` : ''}`;
    const scale = Math.min(S.vw / W, S.vh / H);

    // Adjust geometry
    const cropH = Math.round(cH * 0.66), cropW = Math.round(cropH * g.aspect);
    const cropL = (cW - cropW) / 2, cropT = (cH - cropH) / 2 + 12;
    const pw = cropH * 1.25 * z, ph = cropH * 1.5 * z;
    const eyeX = cropL + cropW / 2, eyeY = cropT + g.eye * cropH;
    const pL = eyeX - pw / 2, pT = eyeY - 0.36 * ph;
    const pcrown = 0.36 * ph - (g.eye - g.crown) * cropH * z, pchin = 0.36 * ph + (g.cmid - g.eye) * cropH * z;
    const line = (y, dashed) => ({ position: 'absolute', left: 0, right: 0, top: y * cropH, height: 0, borderTop: `${dashed ? 1 : 2}px ${dashed ? 'dashed' : 'solid'} ${gc}` });
    const lbl = (y) => ({ position: 'absolute', left: cropW + 14, top: y * cropH - 11, height: 22, display: 'flex', alignItems: 'center', padding: '0 8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', borderLeft: `3px solid ${gc}` });
    const handle = (y) => ({ position: 'absolute', left: cropW - 9, top: y * cropH - 9, width: 18, height: 18, background: '#fff', border: `3px solid ${gc}`, cursor: 'ns-resize', boxShadow: 'var(--shadow-sm)' });
    const hh = pchin - pcrown;
    const faceBox = (cx, cr, Hh, i) => ({ label: `Face ${i}`, style: { position: 'absolute', left: pL + cx - Hh * 0.5, top: pT + cr - Hh * 0.05, width: Hh, height: Hh * 1.2, border: '2px solid var(--color-accent)', background: 'transparent', cursor: 'pointer', padding: 0 } });
    const adj = {
      pw, ph, pcrown, pchin,
      photoBox: { position: 'absolute', left: pL, top: pT, width: pw, height: ph, boxShadow: 'var(--shadow-lg)' },
      crop: { position: 'absolute', left: cropL, top: cropT, width: cropW, height: cropH, boxShadow: '0 0 0 4000px var(--dim)', outline: '2px solid #fff' },
      center: { position: 'absolute', top: 0, bottom: 0, left: cropW / 2, width: 0, borderLeft: `1px dashed ${gc}` },
      crownLine: line(g.crown, true), eyeLine: line(g.eye, true),
      chinBand: { position: 'absolute', left: 0, right: 0, top: g.cmin * cropH, height: (g.cmax - g.cmin) * cropH, background: `color-mix(in srgb, ${gc} 16%, transparent)`, borderTop: `2px solid ${gc}`, borderBottom: `2px solid ${gc}` },
      crownHandle: handle(hd.crown), chinHandle: handle(hd.chin),
      crownLabel: lbl(g.crown), eyeLabel: lbl(g.eye), chinLabel: lbl((g.cmin + g.cmax) / 2),
      faces: [faceBox(pw * 0.13, pcrown + hh * 0.16, hh * 0.8, 1), faceBox(pw / 2, pcrown, hh, 2), faceBox(pw * 0.87, pcrown + hh * 0.1, hh * 0.84, 3)],
    };
    const origin = step === 2 ? `50% ${((cH - Math.round(cH * 0.78)) / 2 + hd.crown * Math.round(cH * 0.78)) / cH * 100}%` : '50% 45%';
    const viewWrap = { position: 'absolute', inset: 0, transform: `scale(${S.viewZoom})`, transformOrigin: origin, transition: 'transform .18s ease-out' };

    // Background compare
    const bh = Math.round(cH * 0.78), bw = Math.round(bh * g.aspect), split = S.compareHeld ? 100 : S.split;
    const cmp = {
      w: bw, h: bh, crown: hd.crown * bh, chin: hd.chin * bh,
      box: { position: 'absolute', left: (cW - bw) / 2, top: (cH - bh) / 2, width: bw, height: bh, cursor: 'ew-resize', boxShadow: 'var(--shadow-lg)', userSelect: 'none', overflow: 'hidden' },
      beforeClip: { position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - split}% 0 0)` },
      handle: { position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.15)' },
    };

    // Sheet
    const lay = this.layout(S.paper);
    const s2 = Math.min((cW - 160) / lay.pw, (cH - 120) / lay.ph);
    const paperW = lay.pw * s2, paperH = lay.ph * s2, paperL = (cW - paperW) / 2, paperT = (cH - paperH) / 2 - 14;
    const tiles = lay.out.map(o => { const tg = this.geom(o.k); const th = this.headAt(tg, z); const tw = o.w * s2, tH = o.h * s2; return { style: { position: 'absolute', left: o.x * s2, top: o.y * s2, width: tw, height: tH, overflow: 'hidden' }, w: tw, h: tH, crown: th.crown * tH, chin: th.chin * tH, tag: o.k === 'passport' ? '' : tagShown }; });
    const ticks = [];
    if (S.cutMarks) {
      const mk = 5 * s2 * 0.7; const xs = new Set(), ys = new Set();
      lay.out.forEach(o => { xs.add(+(o.x).toFixed(2)); xs.add(+(o.x + o.w).toFixed(2)); ys.add(+(o.y).toFixed(2)); ys.add(+(o.y + o.h).toFixed(2)); });
      const c = '#201e1d';
      xs.forEach(x => { ticks.push({ s: { position: 'absolute', left: x * s2, top: 0, width: 1, height: mk, background: c } }); ticks.push({ s: { position: 'absolute', left: x * s2, top: paperH - mk, width: 1, height: mk, background: c } }); });
      ys.forEach(y => { ticks.push({ s: { position: 'absolute', top: y * s2, left: 0, height: 1, width: mk, background: c } }); ticks.push({ s: { position: 'absolute', top: y * s2, left: paperW - mk, height: 1, width: mk, background: c } }); });
    }
    const count = lay.out.length;
    const sh = {
      paper: { position: 'absolute', left: paperL, top: paperT, width: paperW, height: paperH, background: '#ffffff', boxShadow: 'var(--shadow-lg)' },
      margin: { position: 'absolute', inset: 5 * s2, border: '1px dashed #bab6b6', pointerEvents: 'none' },
      tiles, ticks,
      captionPos: { position: 'absolute', left: paperL, top: paperT + paperH + 14, display: 'flex', gap: 8, fontSize: 14, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      orientText: lay.land ? 'Landscape' : 'Portrait', countText: `${count} photo${count === 1 ? '' : 's'}`,
    };
    let fit = { ok: false, bad: false, hasFix: false };
    if (S.mode !== 'fill') {
      if (lay.miss === 0) fit = { ok: true, bad: false, count };
      else {
        const alt = PORDER.find(k => k !== S.paper && this.layout(k).miss === 0);
        fit = { ok: false, bad: true, text: alt ? `Doesn’t fit on ${PAPERS[S.paper].label}, try ${PAPERS[alt].label}` : `${lay.miss} photos don’t fit on any paper`, hasFix: !!alt, fixLabel: alt ? `Switch to ${PAPERS[alt].label}` : '', fix: () => this.setState({ paper: alt }) };
      }
    }
    const callout = S.mode === 'fill' && S.paper === '4R' && S.preset === '2x2';

    const slider = (label, key, min, max, stepv, def, fmt) => ({ label, min, max, step: stepv, value: S[key], text: fmt(S[key]), onChange: (e) => this.set({ [key]: +e.target.value }, key), reset: () => this.set({ [key]: def }, key + 'r') });
    const signed = (v) => (v > 0 ? '+' : '') + v;
    const opts = (list, cur, pick) => list.map(([v, label]) => ({ label, on: cur === v, off: cur !== v, pick: () => pick(v) }));

    const thumbW = 96, thumbH = Math.round(96 / g.aspect);
    const th = this.headAt(g, z);
    const canNextBase = step === 0 ? S.phase === 'done' : true;

    return {
      theme: P.theme === 'Dark' ? 'dark' : 'light',
      frameStyle: { position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: `translate(-50%,-50%) scale(${scale})`, display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' },
      steps: STEPS.map((label, i) => ({ label, n: i + 1, notFirst: i > 0, current: i === step, done: i !== step && i <= S.maxStep, todo: i !== step && i > S.maxStep, go: () => this.go(i) })),
      undo: () => this.undo(), redo: () => this.redo(), noUndo: !S.past.length, noRedo: !S.future.length,
      openSettings: () => this.setState({ settingsOpen: true, toast: null }), closeSettings: () => this.setState({ settingsOpen: false }),
      // import
      isImportIdle: step === 0 && (S.phase === 'empty' || S.phase === 'unsupported' || S.phase === 'done'),
      unsupported: step === 0 && S.phase === 'unsupported',
      dismissUnsupported: () => this.setState({ phase: 'empty' }),
      startImport: () => this.startImport(), cancelImport: () => this.setState({ phase: 'empty', prog: 0 }),
      recent: [['2x2 · Blue', '10:42 AM', '#1E5BC6', .12, .69], ['1x1 · White', '10:31 AM', '#FFFFFF', .10, .75], ['Passport · White', '10:05 AM', '#FFFFFF', .08, .82], ['2x2 · Red', '9:48 AM', '#C62828', .12, .69]].map(([size, time, bg, cr, ch]) => ({ size, time, bg, crown: cr * 48, chin: ch * 48 })),
      isProcessing: step === 0 && S.phase === 'processing',
      shimmer: React.createElement('div', { key: 'shim', style: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' } },
        React.createElement('div', { style: { position: 'absolute', left: 0, right: 0, top: 0, height: '100%', background: 'linear-gradient(to bottom, transparent 0%, rgba(236,48,19,0) 60%, rgba(236,48,19,.28) 97%, #ec3013 100%)', animation: 'scan 1.8s cubic-bezier(.4,0,.2,1) infinite' } })),
      procSteps: [{ label: 'Removing background…', doneLabel: 'Background removed', t: 0.55 }, { label: 'Finding face…', doneLabel: 'Face found', t: 1 }].map((p, i, a) => { const start = i ? a[i - 1].t : 0; return { ...p, done: S.prog >= p.t, active: S.prog >= start && S.prog < p.t, waiting: S.prog < start }; }),
      procBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(S.prog * 100)}%`, background: 'var(--color-accent)' },
      procPct: `${Math.round(S.prog * 100)}%`,
      // adjust
      isAdjust: step === 1, adj, cropRef: this.cropRef, bgHex, rot: S.rot, multi, compareHeld: S.compareHeld, photoFilter,
      dragCrown: (e) => { e.preventDefault(); this.drag = 'crown'; }, dragChin: (e) => { e.preventDefault(); this.drag = 'chin'; },
      showPicker: multi && !S.facePicked && step === 1, pickFace: () => this.setState({ facePicked: true }),
      st: { ok: status === 'ok', warn: status === 'small' || status === 'large', text: status === 'small' ? 'Head too small, zoom in' : 'Head too large, zoom out' },
      noFace, lowRes,
      autoAlign: () => this.set({ zoom: 100, rot: 0 }, 'align'), resetTransform: () => this.set({ zoom: 100, rot: 0 }, 'reset'),
      levelEyes: S.levelEyes, levelOff: !S.levelEyes, toggleLevel: () => this.setState({ levelEyes: !S.levelEyes }),
      adjSliders: [slider('Zoom', 'zoom', 60, 150, 1, 100, v => v + '%'), slider('Rotate', 'rot', -15, 15, 0.5, 0, v => signed(v.toFixed(1)) + '°')],
      viewWrap,
      // preset
      showPreset: step >= 1 && step <= 3,
      presetOpts: opts([['1x1', '1x1'], ['2x2', '2x2'], ['passport', 'Passport'], ['custom', 'Custom']], S.preset, v => this.set({ preset: v }, 'preset' + v)),
      isCustom: S.preset === 'custom',
      unitOpts: opts([['mm', 'mm'], ['in', 'in']], S.unit, v => this.setState({ unit: v })),
      customWVal: S.unit === 'mm' ? trim(S.customW, 1) : trim(S.customW / 25.4, 2), customHVal: S.unit === 'mm' ? trim(S.customH, 1) : trim(S.customH / 25.4, 2),
      setCustomW: (e) => { const v = parseFloat(e.target.value); if (v > 0) this.set({ customW: S.unit === 'mm' ? v : v * 25.4 }, 'cw'); },
      setCustomH: (e) => { const v = parseFloat(e.target.value); if (v > 0) this.set({ customH: S.unit === 'mm' ? v : v * 25.4 }, 'ch'); },
      sizeText, presetLabel: g.label, isPassport,
      // background
      isBg: step === 2, cmp, cmpRef: this.cmpRef, tagShown,
      startSplit: (e) => { this.drag = 'split'; this.handleDrag(e); },
      inspecting: step === 2 && S.viewZoom > 2,
      swatches: [...BGS, { k: 'custom', label: 'Custom', hex: S.customHex }].map(b => ({ label: b.label, on: S.bg === b.k, off: S.bg !== b.k, pick: () => this.set({ bg: b.k }, 'bg' + b.k), chip: { display: 'block', height: 40, background: b.k === 'custom' && S.bg !== 'custom' ? 'conic-gradient(from 90deg, #C62828, #E9C46A, #1f9d5c, #1E5BC6, #8e44ad, #C62828)' : b.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)' } })),
      bgCustom: S.bg === 'custom', customHex: S.customHex, setCustomHex: (e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) this.set({ customHex: v }, 'hex'); },
      passportNotWhite: isPassport && S.bg !== 'white', pickWhite: (e) => { e.preventDefault(); this.set({ bg: 'white' }, 'bgw'); },
      edgeSliders: [slider('Edge softness', 'edge', -2, 2, 1, 0, signed), slider('Hair detail', 'hair', 0, 100, 1, 60, v => v)],
      adjOpen: S.adjOpen, toggleAdjOpen: () => this.setState({ adjOpen: !S.adjOpen }), adjChevron: { transform: S.adjOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' },
      photoSliders: [slider('Brightness', 'bright', -50, 50, 1, 0, signed), slider('Contrast', 'contrast', -50, 50, 1, 0, signed), slider('Warmth', 'warmth', -50, 50, 1, 0, signed)],
      tagOpen: S.tagOpen, toggleTagOpen: () => this.setState({ tagOpen: !S.tagOpen }), tagChevron: { transform: S.tagOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' },
      tagAllowed: !isPassport, tagOn: S.tagOn && !isPassport, tagOff: !S.tagOn, toggleTag: () => this.setState({ tagOn: !S.tagOn }),
      tagText: S.tagText, setTagText: (e) => this.setState({ tagText: e.target.value }),
      tagPrev: { crown: th.crown * 96, chin: th.chin * 96 },
      // sheet
      isSheet: step === 3, isSheetView: step === 3 || step === 4, sh,
      paperLabel: PAPERS[S.paper].label, paperDim: PAPERS[S.paper].dim,
      paperOpts: PORDER.map(k => ({ label: PAPERS[k].label, dim: PAPERS[k].dim, on: S.paper === k, off: S.paper !== k, pick: () => this.setState({ paper: k }) })),
      modeOpts: [['fill', 'Fill sheet', S.mode === 'fill' ? `${count} photos` : ''], ['exact', 'Exact quantity', ''], ['package', 'Package', 'mixed sizes']].map(([v, label, note]) => ({ label, note, on: S.mode === v, off: S.mode !== v, pick: () => this.setState({ mode: v }) })),
      isExact: S.mode === 'exact', isPackage: S.mode === 'package', qty: S.qty,
      qtyDec: () => this.setState({ qty: Math.max(1, S.qty - 1) }), qtyInc: () => this.setState({ qty: S.qty + 1 }),
      savedOpts: SAVED.map((p, i) => ({ value: String(i), label: p.label })), savedVal: S.savedVal,
      pickSaved: (e) => { const i = e.target.value; if (i === '') return this.setState({ savedVal: '' }); const p = SAVED[+i]; this.setState({ savedVal: i, rows: p.rows.map(r => [...r]), paper: p.paper }); },
      pkgRows: S.rows.map(([k, q], i) => ({
        qty: q,
        sizes: opts([['1x1', '1x1'], ['2x2', '2x2'], ['passport', 'Passport']], k, v => this.setState(st => ({ rows: st.rows.map((r, j) => j === i ? [v, r[1]] : r), savedVal: '' }))),
        dec: () => this.setState(st => ({ rows: st.rows.map((r, j) => j === i ? [r[0], Math.max(1, r[1] - 1)] : r), savedVal: '' })),
        inc: () => this.setState(st => ({ rows: st.rows.map((r, j) => j === i ? [r[0], r[1] + 1] : r), savedVal: '' })),
        remove: () => this.setState(st => ({ rows: st.rows.filter((_, j) => j !== i), savedVal: '' })),
      })),
      addRow: () => this.setState(st => ({ rows: [...st.rows, ['1x1', 2]], savedVal: '' })),
      fit, callout,
      useCombo: () => this.setState({ mode: 'package', rows: SAVED[0].rows.map(r => [...r]), savedVal: '0' }), toA4: () => this.setState({ paper: 'A4' }),
      cutMarks: S.cutMarks, cutOff: !S.cutMarks, toggleCut: () => this.setState({ cutMarks: !S.cutMarks }),
      orientOpts: opts([['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], S.orient, v => this.setState({ orient: v })),
      // export
      isExport: step === 4,
      thumb: { w: thumbW, h: thumbH, crown: th.crown * thumbH, chin: th.chin * thumbH },
      thumbBox: { width: thumbW, height: thumbH, flex: 'none', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' },
      summary: [
        { k: 'Background', v: bgLabel, hasSw: true, sw: { width: 16, height: 16, background: bgHex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' } },
        { k: 'Paper', v: `${PAPERS[S.paper].label} · ${PAPERS[S.paper].dim}` },
        { k: 'Photos on sheet', v: String(count) },
        { k: 'Resolution', v: '300 DPI' },
      ],
      printLabel: S.printing ? 'Preparing PDF…' : 'Print',
      doPrint: () => this.doPrint(),
      saveOpts: [['Save sheet as PDF', 'Ctrl+S'], ['Save sheet as JPG / PNG', ''], ['Save single photo', 'JPG / PNG']].map(([label, hint]) => ({ label, hint, go: () => this.doPrint() })),
      // footer
      showViewTools: step >= 1, showCompare: step === 1 || step === 2,
      viewZoomText: Math.round(S.viewZoom * 100) + '%',
      zoomIn: () => this.setState({ viewZoom: Math.min(4, +(S.viewZoom * 1.25).toFixed(3)) }), zoomOut: () => this.setState({ viewZoom: Math.max(0.5, +(S.viewZoom / 1.25).toFixed(3)) }),
      fitView: () => this.setState({ viewZoom: 1 }), inspect100: () => this.setState({ viewZoom: 2.6 }),
      holdOn: () => this.setState({ compareHeld: true }), holdOff: () => { if (this.state.compareHeld) this.setState({ compareHeld: false }); },
      hasPanel, canBack: step > 0, back: () => this.back(),
      canNext: canNextBase, nextDisabled: !canNextBase, next: () => this.next(), nextLabel: NEXT[step],
      nextHint: step === 4 ? '' : step === 0 ? 'Ctrl+O to open' : 'Enter',
      // toast
      toast: !!S.toast, toastOk: S.toast && S.toast.kind === 'ok', toastErr: S.toast && S.toast.kind === 'err',
      toastTitle: S.toast ? S.toast.title : '', toastBody: S.toast ? S.toast.body : '',
      closeToast: () => this.setState({ toast: null }), newPhoto: () => this.newPhoto(),
      // settings
      settingsOpen: S.settingsOpen,
      tabs: [['defaults', 'Defaults'], ['models', 'Models'], ['about', 'About']].map(([v, label]) => ({ label, on: S.tab === v, off: S.tab !== v, pick: () => this.setState({ tab: v }) })),
      tabDefaults: S.tab === 'defaults', tabModels: S.tab === 'models', tabAbout: S.tab === 'about',
      qualityOpts: [['standard', 'Standard'], ['hd', 'HD']].map(([v, label]) => { const dis = v === 'hd' && S.hd !== 'installed'; return { label, on: !dis && S.quality === v, off: !dis && S.quality !== v, disabled: dis, pick: () => this.setState({ quality: v }) }; }),
      getHd: (e) => { e.preventDefault(); this.setState({ hd: 'downloading', hdProg: 0 }); },
      hdInstalled: S.hd === 'installed', hdNotInstalled: S.hd !== 'installed', hdIdle: S.hd === 'none',
      hdBusy: S.hd === 'downloading' || S.hd === 'paused', hdDownloading: S.hd === 'downloading', hdPaused: S.hd === 'paused',
      hdBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: `${S.hdProg * 100}%`, background: 'var(--color-accent)' },
      hdText: `${S.hd === 'paused' ? 'Paused · ' : ''}${Math.round(S.hdProg * 973)} of 973 MB · ${Math.round(S.hdProg * 100)}%`,
      hdDownload: () => this.setState({ hd: 'downloading', hdProg: 0 }), hdPause: () => this.setState({ hd: 'paused' }), hdResume: () => this.setState({ hd: 'downloading' }),
      hdRemove: () => this.setState({ hd: 'none', hdProg: 0, quality: 'standard' }),
      hdError: S.hd === 'failed' || S.hd === 'mismatch',
      hdErrTitle: S.hd === 'mismatch' ? 'Checksum mismatch' : 'Download failed',
      hdErrBody: S.hd === 'mismatch' ? 'The downloaded file doesn’t match the expected checksum and may be damaged. It was not installed.' : 'The connection dropped at 412 of 973 MB. Your progress is kept — retry to resume.',
    };
  }
}
