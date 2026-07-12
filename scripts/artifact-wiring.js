/* Vanilla wiring for the Nodus playground artifact. Uses the global `Nodus` (IIFE bundle). */
(function () {
  const N = window.Nodus;
  const $ = (id) => document.getElementById(id);

  // ---- sample model ----
  const model = {
    nodes: [
      { key: 'cdn', type: 'edge', label: 'CDN / Edge', x: 40, y: 300 },
      { key: 'lb', type: 'lb', label: 'Load Balancer', x: 250, y: 300 },
      { key: 'gw', type: 'service', label: 'API Gateway', x: 470, y: 170 },
      { key: 'auth', type: 'service', label: 'Auth Service', x: 470, y: 310, focused: true },
      { key: 'orders', type: 'service', label: 'Orders API', x: 470, y: 450 },
      { key: 'redis', type: 'cache', label: 'Redis', x: 720, y: 170, overlay: 'met' },
      { key: 'pg', type: 'db', label: 'Postgres', x: 720, y: 320, overlay: 'partial' },
      { key: 'kafka', type: 'queue', label: 'Kafka', x: 720, y: 470, overlay: 'missed' },
      { key: 'pay', type: 'service', label: 'Payments', x: 980, y: 250, state: 'solid' },
      { key: 'legacy', type: 'service', label: 'Legacy', x: 980, y: 410, state: 'locked' },
    ],
    edges: [
      { from: 'cdn', to: 'lb' }, { from: 'lb', to: 'gw' }, { from: 'lb', to: 'auth' },
      { from: 'lb', to: 'orders' }, { from: 'gw', to: 'redis' }, { from: 'auth', to: 'pg' },
      { from: 'orders', to: 'pg' }, { from: 'orders', to: 'kafka' }, { from: 'orders', to: 'pay' },
      { from: 'pay', to: 'legacy' },
    ],
  };

  const handle = N.InfraCanvas({ model, viewport: { w: 1000, h: 600 } });
  const editor = handle.editor;
  editor.registerLayout(N.dagreLayout);
  editor.registerLayout(N.treeLayout);
  editor.registerLayout(N.forceLayout);
  N.installDrawTools(editor);
  editor.snap.grid = 8;
  window.__editor = editor;

  // crash recovery + autosave to localStorage (the served page has no doc server)
  const docStore = new N.LocalDocStore();
  N.loadDoc(editor, docStore, 'playground', { fit: true }).then((loaded) => {
    if (!loaded) {
      editor.zoomToFit(60);
      // show flow animation on the fresh sample (capture:'never' → a visual default, not an undo entry)
      editor.setFlow(editor.store.edges().map((e) => e.id), { style: 'dots' }, { capture: 'never' });
      schedule();
    }
  });
  N.autosave(editor, docStore, 'playground', { debounceMs: 600 });

  // ---- themes (demonstrates the theming axis) ----
  const dark = editor.themeAtom.peek();
  const light = {
    ...dark,
    name: 'infra-light',
    canvas: { fill: '#f6f7f5', grid: { color: 'rgba(16,42,32,0.06)', size: 24 } },
    states: {
      accent: { fill: '#ffffff', strokeWidth: 1.4 },
      solid: { fill: '#ffffff', stroke: '#9aa39d', strokeWidth: 1.2, text: '#0f1a15', glow: null },
      ghost: { fill: '#eef0ed', stroke: '#d5dad4', strokeWidth: 1, text: '#9aa39d', opacity: 0.6, glow: null },
      locked: { fill: '#ffffff', stroke: '#c4cbc5', strokeWidth: 1, text: '#9aa39d', dash: [4, 4], labelOverride: '?', glow: null },
    },
  };
  let isDark = true;

  // ---- canvas mount + reactive render loop ----
  const stage = $('stage');
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  let raf = 0;
  const dpr = () => Math.max(1, Math.min(2, Math.floor(window.devicePixelRatio || 1)));
  function paint() {
    raf = 0;
    const r = stage.getBoundingClientRect();
    editor.render(ctx, r.width, r.height, dpr(), true, performance.now());
    drawMini();
    if (editor.hasFlow()) schedule(); // keep animating while any edge is flowing (else idle = 0 paints)
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(paint); }
  function resize() {
    const r = stage.getBoundingClientRect();
    editor.setViewport(r.width, r.height);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    canvas.width = Math.floor(r.width * dpr());
    canvas.height = Math.floor(r.height * dpr());
    schedule();
  }
  N.effect(() => {
    editor.sceneIndex.version.get(); editor.cameraAtom.get(); editor.themeAtom.get();
    editor.selectedAtom.get(); editor.hoveredAtom.get(); editor.marqueeAtom.get();
    editor.connectDraftAtom.get(); editor.createPreviewAtom.get();
    editor.editingAtom.get(); editor.overlaysAtom.get(); editor.viewportAtom.get();
    schedule();
  });
  new ResizeObserver(resize).observe(stage);
  resize();
  requestAnimationFrame(() => editor.zoomToFit(60));

  // ---- pointer / wheel / keyboard ----
  let panning = false, spaceDown = false, last = { x: 0, y: 0 };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const mods = (e) => ({ button: e.button, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown)) { panning = true; last = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; return; }
    editor.pointerDown(local(e), mods(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (panning) { editor.panByScreen(e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY }; return; }
    editor.pointerMove(local(e), mods(e));
  });
  canvas.addEventListener('pointerup', (e) => {
    if (panning) { panning = false; canvas.style.cursor = spaceDown ? 'grab' : 'default'; return; }
    editor.pointerUp(local(e), mods(e));
  });
  canvas.addEventListener('dblclick', (e) => editor.doubleClick(local(e), { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey }));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) editor.zoomBy(Math.exp(-e.deltaY * 0.0016), local(e));
    else editor.panByScreen(-e.deltaX, -e.deltaY);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { spaceDown = true; if (!panning) canvas.style.cursor = 'grab'; return; }
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
    if (editor.editingAtom.peek()) return;
    if (!meta && N.drawShortcut(editor, e.key)) return; // R/E/D/T/L/A/V draw shortcuts
    editor.keyDown({ key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; if (!panning) canvas.style.cursor = 'default'; } });

  // ---- inline label editor ----
  const overlay = $('edit');
  N.effect(() => {
    const id = editor.editingAtom.get();
    const cam = editor.cameraAtom.get();
    if (!id) { overlay.style.display = 'none'; return; }
    const rec = editor.store.peek(id);
    if (!rec) { overlay.style.display = 'none'; return; }
    const tl = N.worldToScreen(cam, { x: rec.x, y: rec.y });
    overlay.style.display = 'block';
    overlay.style.left = tl.x + 'px';
    overlay.style.top = tl.y + 'px';
    overlay.style.width = rec.w * cam.z + 'px';
    overlay.style.height = rec.h * cam.z + 'px';
    overlay.style.lineHeight = rec.h * cam.z + 'px';
    overlay.value = rec.label || '';
    setTimeout(() => { overlay.focus(); overlay.select(); }, 0);
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.commitEdit(overlay.value); }
    else if (e.key === 'Escape') { e.preventDefault(); editor.cancelEdit(); }
    e.stopPropagation();
  });
  overlay.addEventListener('blur', () => { if (editor.editingAtom.peek()) editor.commitEdit(overlay.value); });

  // ---- toolbar ----
  let toolId = 'select';
  function setTool(id, cfg) { editor.setTool(id, cfg); toolId = id; syncTools(); }
  function syncTools() {
    ['select', 'connect', 'create'].forEach((t) => $('t-' + t).classList.toggle('on', toolId === t));
  }
  $('t-select').onclick = () => setTool('select');
  $('t-connect').onclick = () => setTool('connect');
  $('t-create').onclick = () => setTool('create', { type: 'infra.' + $('type').value });
  $('type').onchange = () => { if (toolId === 'create') setTool('create', { type: 'infra.' + $('type').value }); };
  const drawBtn = (id, tool, type) => { const el = $(id); if (el) el.onclick = () => setTool(tool, { type }); };
  drawBtn('d-rect', 'create', 'draw.rect');
  drawBtn('d-ellipse', 'create', 'draw.ellipse');
  drawBtn('d-diamond', 'create', 'draw.diamond');
  drawBtn('d-text', 'create', 'draw.text');
  drawBtn('d-line', 'line', 'draw.line');
  drawBtn('d-arrow', 'line', 'draw.arrow');
  if ($('reset')) $('reset').onclick = () => { docStore.remove('playground'); location.reload(); };

  // toggle animated flow (packets) on every edge
  if ($('flow')) $('flow').onclick = () => {
    const on = !editor.hasFlow();
    editor.setFlow(editor.store.edges().map((e) => e.id), on ? { style: 'dots' } : null);
    $('flow').textContent = on ? '⇢ Flow ✓' : '⇢ Flow';
    schedule();
  };

  // "Live" demo — data-driven flow: each link's health random-walks; packet SPEED + COLOR track it
  // (healthy = fast green, congested = slow red). Metric updates are ephemeral (no doc churn).
  let liveTimer = null;
  const HEALTH = {};
  if ($('live')) $('live').onclick = () => {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
      editor.clearFlowMetrics();
      editor.setFlow(editor.store.edges().map((e) => e.id), null);
      $('live').textContent = '📊 Live';
      $('flow').textContent = '⇢ Flow';
      schedule();
      return;
    }
    const scale = {
      domain: [0, 1],
      speed: [8, 130],
      count: [1, 4],
      size: [2, 4.5],
      colors: [{ at: 0, color: '#ef4444' }, { at: 0.4, color: '#f59e0b' }, { at: 0.7, color: '#22c55e' }],
    };
    editor.setFlow(editor.store.edges().map((e) => e.id), { style: 'dots', scale }, { capture: 'never' });
    const tick = () => {
      for (const e of editor.store.edges()) {
        let v = HEALTH[e.id];
        if (v == null) v = Math.random();
        v = Math.min(1, Math.max(0, v + (Math.random() - 0.5) * 0.35)); // random walk
        HEALTH[e.id] = v;
        editor.setFlowMetric(e.id, v);
      }
      schedule();
    };
    tick();
    liveTimer = setInterval(tick, 650);
    $('live').textContent = '📊 Live ✓';
    $('flow').textContent = '⇢ Flow ✓';
  };

  // ---- Mermaid import (flowchart / state / ER → dagre layout) ----
  const MSAMPLES = {
    flow: 'flowchart LR\n  A([Start]) --> B{Auth OK?}\n  B -->|yes| C[Fetch Orders]\n  B -->|no| D[[Return 401]]\n  C --> E[(Postgres)]\n  C --> F{Cache hit?}\n  F -->|hit| G([Respond])\n  F -->|miss| E\n  E --> G',
    state: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Loading : fetch\n  Loading --> Ready : ok\n  Loading --> Error : fail\n  Error --> Idle : retry\n  Ready --> [*]',
    er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n  CUSTOMER {\n    string name PK\n    string email\n  }\n  ORDER {\n    int id PK\n    float total\n  }',
  };
  let diagramsReady = false;
  const mmodal = $('mmodal');
  const openMermaid = () => { $('mtext').value = MSAMPLES[$('msample').value] || MSAMPLES.flow; $('merr').textContent = ''; mmodal.classList.add('on'); setTimeout(() => $('mtext').focus(), 0); };
  const closeMermaid = () => mmodal.classList.remove('on');
  if ($('mermaid')) $('mermaid').onclick = openMermaid;
  if ($('mx')) $('mx').onclick = closeMermaid;
  if ($('msample')) $('msample').onchange = () => { $('mtext').value = MSAMPLES[$('msample').value] || ''; };
  if (mmodal) mmodal.addEventListener('pointerdown', (e) => { if (e.target === mmodal) closeMermaid(); });
  if ($('mgo')) $('mgo').onclick = async () => {
    const src = $('mtext').value.trim();
    if (!src) return;
    try {
      editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }); // fresh scene for the import
      if (!diagramsReady) { N.installDiagrams(editor); diagramsReady = true; }
      await N.importMermaid(editor, src, { layout: 'dagre' });
      closeMermaid();
      schedule();
    } catch (e) { $('merr').textContent = String((e && e.message) || e); }
  };
  // copy-as-image (selection or all) → clipboard, with a download fallback
  if ($('copy')) $('copy').onclick = async () => {
    const sel = editor.selectedIdsArray();
    const base = sel.length ? editor.selectionBounds() : editor.sceneIndex.contentBounds();
    if (!base) return;
    const region = N.padBox(base, 24);
    const ratio = 2;
    const oc = new OffscreenCanvas(Math.ceil(region.w * ratio), Math.ceil(region.h * ratio));
    editor.paintRegion(oc.getContext('2d'), region, ratio, { background: true });
    const blob = await oc.convertToBlob({ type: 'image/png' });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      $('copy').textContent = 'Copied ✓';
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'diagram.png';
      a.click();
      $('copy').textContent = 'Downloaded ✓';
    }
    setTimeout(() => ($('copy').textContent = 'Copy PNG'), 1400);
  };
  $('undo').onclick = () => editor.undo();
  $('redo').onclick = () => editor.redo();
  $('del').onclick = () => editor.deleteRecords(editor.selectedIdsArray());
  $('dup').onclick = () => editor.duplicate();
  $('group').onclick = () => editor.group(editor.selectedIdsArray());
  $('ungroup').onclick = () => editor.selectedIdsArray().forEach((id) => editor.ungroup(id));
  $('fit').onclick = () => editor.zoomToFit(60);
  $('layout').onclick = () => editor.layout($('layout-kind').value, { direction: 'LR' });
  $('router').onchange = () => {
    const r = $('router').value;
    const sel = editor.selectedIdsArray().filter((id) => editor.store.peek(id)?.typeName === 'edge');
    (sel.length ? sel : editor.store.edges().map((e) => e.id)).forEach((id) => editor.setEdgeRouter(id, r));
  };
  $('snap').onclick = () => {
    const on = editor.snap.grid === 0;
    editor.snap.grid = on ? 8 : 0;
    $('snap').classList.toggle('on', on);
    $('snap').textContent = on ? 'Snap: On' : 'Snap: Off';
  };

  // theme cycling through the built-in pack
  const themes = [
    { name: 'Infra Dark', t: dark, light: false },
    { name: 'PIS', t: N.themePack.pis, light: false },
    { name: 'Infra Light', t: light, light: true },
    { name: 'Blueprint', t: N.themePack.blueprint, light: false },
    { name: 'Neon', t: N.themePack.neon, light: false },
    { name: 'Paper', t: N.themePack.paper, light: true },
  ];
  let themeIdx = 0;
  $('theme').onclick = () => {
    themeIdx = (themeIdx + 1) % themes.length;
    const th = themes[themeIdx];
    editor.setTheme(th.t);
    document.body.classList.toggle('lightcanvas', th.light);
    $('theme').textContent = 'Theme: ' + th.name;
  };
  void isDark;

  // reactive toolbar state
  N.effect(() => {
    editor.history.version.get();
    $('undo').disabled = !editor.history.canUndo();
    $('redo').disabled = !editor.history.canRedo();
  });
  N.effect(() => {
    editor.sceneIndex.version.get();
    const sel = editor.selectedAtom.get().size;
    $('stat').textContent = editor.store.nodes().length + ' nodes · ' + editor.store.edges().length + ' edges · ' + sel + ' selected';
  });

  const TYPES = N.INFRA_TYPES;
  const sel = $('type');
  TYPES.forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
  sel.value = 'service';
  syncTools();

  // ---- minimap ----
  const mini = $('mini');
  const mctx = mini.getContext('2d');
  const MW = 200, MH = 130, MPAD = 10;
  function miniFit() {
    const b = editor.sceneIndex.contentBounds();
    if (!b) return null;
    const s = Math.min((MW - 2 * MPAD) / b.w, (MH - 2 * MPAD) / b.h) || 1;
    return { s, ox: MPAD + (MW - 2 * MPAD - b.w * s) / 2 - b.x * s, oy: MPAD + (MH - 2 * MPAD - b.h * s) / 2 - b.y * s };
  }
  function drawMini() {
    const theme = editor.themeAtom.peek();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, MW, MH);
    mctx.fillStyle = theme.canvas.fill;
    mctx.fillRect(0, 0, MW, MH);
    const f = miniFit();
    if (!f) return;
    for (const it of editor.sceneIndex.paintOrder()) {
      if (it.kind !== 'node') continue;
      const a = it.aabb;
      mctx.fillStyle = N.resolveTokens(theme, it.record.visual, it.record.type).stroke;
      mctx.globalAlpha = 0.85;
      mctx.fillRect(a.x * f.s + f.ox, a.y * f.s + f.oy, Math.max(2, a.w * f.s), Math.max(2, a.h * f.s));
    }
    mctx.globalAlpha = 1;
    const vp = editor.worldViewport();
    mctx.strokeStyle = theme.palette.accent || '#10b981';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(vp.x * f.s + f.ox, vp.y * f.s + f.oy, vp.w * f.s, vp.h * f.s);
  }
  let mdrag = false;
  function mrecenter(e) {
    const f = miniFit();
    if (!f) return;
    const r = mini.getBoundingClientRect();
    const wx = (e.clientX - r.left - f.ox) / f.s;
    const wy = (e.clientY - r.top - f.oy) / f.s;
    const cam = editor.camera;
    const vp = editor.viewportAtom.peek();
    editor.setCamera({ x: wx - vp.w / (2 * cam.z), y: wy - vp.h / (2 * cam.z), z: cam.z });
  }
  mini.addEventListener('pointerdown', (e) => { mdrag = true; mini.setPointerCapture(e.pointerId); mrecenter(e); });
  mini.addEventListener('pointermove', (e) => { if (mdrag) mrecenter(e); });
  mini.addEventListener('pointerup', () => { mdrag = false; });

  // ---- context menu ----
  const ctxEl = $('ctx');
  const hideCtx = () => { ctxEl.style.display = 'none'; };
  const styleItems = (ids) => [
    { label: 'Style → red', run: () => editor.setStyle(ids, { stroke: '#ef4444', text: '#ef4444', glow: '#ef4444' }) },
    { label: 'Style → amber', run: () => editor.setStyle(ids, { stroke: '#f59e0b', text: '#f59e0b', glow: '#f59e0b' }) },
    { label: 'Style → dashed', run: () => editor.setStyle(ids, { dash: [5, 4] }) },
    { label: 'Clear style', run: () => editor.clearStyle(ids) },
  ];
  function ctxItems(target) {
    const s = editor.selectedIdsArray();
    if (!target) {
      const it = [];
      if (editor.hasClipboard()) it.push({ label: 'Paste', run: () => editor.paste() });
      it.push({ label: 'Select all', run: () => editor.selectAll() });
      it.push({ label: 'Zoom to fit', run: () => editor.zoomToFit(60) });
      return it;
    }
    const id = target.id;
    if (target.kind === 'edge') return [
      { label: 'Edit label', run: () => editor.beginEdit(id) },
      { label: 'Router → orthogonal', run: () => editor.setEdgeRouter(id, 'orthogonal') },
      { label: 'Router → straight', run: () => editor.setEdgeRouter(id, 'straight') },
      { label: 'Router → bezier', run: () => editor.setEdgeRouter(id, 'bezier') },
      ...styleItems([id]),
      { label: 'Delete edge', danger: true, run: () => editor.deleteRecords([id]) },
    ];
    const rec = editor.store.peek(id);
    const isGroup = rec && rec.type === 'group';
    const it = [
      { label: 'Edit label', run: () => editor.beginEdit(id) },
      { label: 'Duplicate', run: () => { if (!editor.isSelected(id)) editor.select([id]); editor.duplicate(); } },
    ];
    if (isGroup) it.push({ label: 'Ungroup', run: () => editor.ungroup(id) });
    else if (s.length > 1 && editor.isSelected(id)) it.push({ label: 'Group selection', run: () => editor.group(s) });
    it.push({ label: 'Bring to front', run: () => editor.bringToFront(editor.isSelected(id) ? s : [id]) });
    it.push({ label: 'Send to back', run: () => editor.sendToBack(editor.isSelected(id) ? s : [id]) });
    for (const si of styleItems(editor.isSelected(id) ? s : [id])) it.push(si);
    it.push({ label: 'Delete', danger: true, run: () => editor.deleteRecords(editor.isSelected(id) ? s : [id]) });
    return it;
  }
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const world = editor.screenToWorld(local(e));
    const target = editor.sceneIndex.hitTest(world, 6 / editor.camera.z);
    if (target && !editor.isSelected(target.id)) editor.select([target.id]);
    ctxEl.innerHTML = '';
    for (const item of ctxItems(target)) {
      const d = document.createElement('div');
      d.className = 'item' + (item.danger ? ' danger' : '');
      d.textContent = item.label;
      d.onpointerdown = (ev) => { ev.preventDefault(); item.run(); hideCtx(); };
      ctxEl.appendChild(d);
    }
    const r = stage.getBoundingClientRect();
    ctxEl.style.left = (e.clientX - r.left) + 'px';
    ctxEl.style.top = (e.clientY - r.top) + 'px';
    ctxEl.style.display = 'block';
  });
  window.addEventListener('pointerdown', (e) => { if (!ctxEl.contains(e.target)) hideCtx(); }, true);
})();
