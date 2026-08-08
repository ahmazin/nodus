/**
 * `<Nodus>` — the React host. Mounts a canvas, drives a signal-reactive rAF render loop, forwards
 * pointer/wheel/keyboard to the editor's tools, and hosts the inline text-edit overlay. No engine
 * logic lives here; all behavior is delegated to the `Editor`. The package barrel (`index.tsx`)
 * re-exports this plus the panels/ui surface.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useValue } from './use-value.js';
import { useIsomorphicLayoutEffect } from './ui/use-isomorphic-layout-effect.js';
import { registerCanvas, unregisterCanvas } from './canvas-registry.js';
import {
  effect,
  fmt,
  worldToScreen,
  type Camera,
  type ChangeInfo,
  type Ctx2D,
  type DeepPartial,
  type Editor,
  type Id,
  type NodeRecord,
  type RenderItem,
  type Vec2,
} from '@nodus-dev/core';
import { NodusContextMenu, type MenuItem } from './context-menu.js';
import { injectGlobalStyles } from './ui/global-styles.js';
import { pasteFromSystem } from './clipboard.js';
import { useMessages, type ReactMessages } from './messages.js';
import { pinchDelta, pinchSample, TOUCH_HIT_TOL, type PinchSample, type TouchPoint } from './touch.js';

export interface NodusProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
  /** Show the built-in right-click context menu (default true). */
  contextMenu?: boolean;
  /** Where keyboard shortcuts (undo, nudge, zoom, …) listen. `'host'` (default) attaches keydown/keyup
   *  to the canvas host element, so shortcuts fire only while it (or its children) hold focus — the
   *  correct choice when several editors, or other focusable UI, share the page. `'window'` attaches
   *  them to `window` (legacy app-wide behavior). Read once at mount; changing it later has no effect
   *  until the `editor` prop changes. */
  keyboardScope?: 'host' | 'window';
  /** Inject the (zero-network, `[data-nodus-ui]`-scoped) base stylesheet on mount (default true).
   *  Pass `false` when the embedding app supplies its own styling for the Nodus chrome. Read once
   *  at mount, like `keyboardScope`. */
  injectStyles?: boolean;
  /** Node type to insert when an image is pasted from the system clipboard (e.g. `'diagram.image'`).
   *  Omit to ignore pasted images. */
  imageNodeType?: string;
  /** Node type to insert when plain text is pasted from the system clipboard. Omit to ignore text. */
  textNodeType?: string;
  /** Called once per editor instance, after the host has mounted and wired the editor to the canvas. */
  onMount?: (editor: Editor) => void;
  /** Called on every document mutation (the engine's `change` event). */
  onChange?: (info: ChangeInfo) => void;
  /** Called when the selection changes, with the new selected ids. */
  onSelectionChange?: (ids: Id[]) => void;
  /** Called when the camera (pan/zoom) changes. */
  onCameraChange?: (camera: Camera) => void;
  /** Localized string overrides for the host chrome (canvas aria-label, inline editor, the aria-live
   *  selection announcer) — deep-merged over the English defaults. Also forwarded to the built-in
   *  context menu. */
  messages?: DeepPartial<ReactMessages>;
  /** Replace the built-in context-menu items with your own, computed for the clicked/selected target. */
  contextMenuItems?: (editor: Editor, target: RenderItem | null) => MenuItem[];
  /** Transform/extend the built-in context-menu items (append custom actions, filter, reorder). Runs
   *  after `contextMenuItems`. */
  contextMenuExtendItems?: (editor: Editor, target: RenderItem | null, defaults: MenuItem[]) => MenuItem[];
}

/** Imperative handle exposed via `ref` on `<Nodus>`. */
export interface NodusHandle {
  /** The underlying `<canvas>` element, or `null` before mount / after unmount. */
  canvas: HTMLCanvasElement | null;
  /** The host `<div>` that owns focus and sizing, or `null` before mount / after unmount. */
  host: HTMLDivElement | null;
  /** Move keyboard focus to the canvas host (so shortcuts and Tab traversal target this editor). */
  focus(): void;
}

export const Nodus = forwardRef<NodusHandle, NodusProps>(function Nodus(
  { editor, className, style, contextMenu = true, keyboardScope = 'host', injectStyles = true, imageNodeType, textNodeType, onMount, onChange, onSelectionChange, onCameraChange, messages, contextMenuItems, contextMenuExtendItems },
  ref,
): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: RenderItem | null } | null>(null);
  // aria-live selection announcement (WCAG: selection is otherwise painted only on the canvas).
  const [srMessage, setSrMessage] = useState('');
  const cmRef = useRef(contextMenu);
  cmRef.current = contextMenu;
  // Resolved host chrome messages, kept in a ref so the editor-keyed effects read the latest without
  // re-subscribing.
  const m = useMessages(editor, messages);
  const messagesRef = useRef(m);
  messagesRef.current = m;
  // Paste target types are read lazily inside the (editor-only-deps) effect, mirroring `cmRef`.
  const imageTypeRef = useRef(imageNodeType);
  imageTypeRef.current = imageNodeType;
  const textTypeRef = useRef(textNodeType);
  textTypeRef.current = textNodeType;
  // Keyboard scope is read once at effect setup (see below); the ref just carries the latest prop there.
  const keyboardScopeRef = useRef(keyboardScope);
  keyboardScopeRef.current = keyboardScope;
  const injectStylesRef = useRef(injectStyles);
  injectStylesRef.current = injectStyles;
  // Integration callbacks live in refs so a parent passing fresh closures every render never forces the
  // subscription effect to tear down and resubscribe.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;
  // Tracks which instance `onMount` already fired for, so StrictMode's double-invoked effect fires it
  // exactly once per editor instance.
  const mountedForRef = useRef<Editor | null>(null);

  useImperativeHandle(ref, (): NodusHandle => ({
    get canvas() { return canvasRef.current; },
    get host() { return hostRef.current; },
    focus() { hostRef.current?.focus({ preventScroll: true }); },
  }), []);

  // Integration props → editor events. Keyed on `editor` only (callbacks are read through refs), so the
  // subscription is set up once per instance and torn down on unmount / instance swap.
  useEffect(() => {
    if (mountedForRef.current !== editor) {
      mountedForRef.current = editor;
      onMountRef.current?.(editor);
    }
    const offs = [
      editor.on('change', (e) => onChangeRef.current?.(e.info)),
      editor.on('selection', (e) => {
        onSelectionChangeRef.current?.(e.ids);
        setSrMessage(selectionAnnouncement(editor, e.ids, messagesRef.current.host));
      }),
      editor.on('camera', (e) => onCameraChangeRef.current?.(e.camera)),
    ];
    return () => { for (const off of offs) off(); };
  }, [editor]);

  useIsomorphicLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    // Read at mount: this effect re-runs only when `editor` changes, so a later `keyboardScope` prop
    // change is intentionally ignored until then (documented on the prop).
    const keyScope = keyboardScopeRef.current;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    registerCanvas(editor, canvas);
    if (injectStylesRef.current !== false) injectGlobalStyles(); // idempotent: focus rings + chrome base styles, app-wide

    // Enable the static-layer cache: hover / selection / marquee / flow frames blit a cached bitmap
    // of the unchanged scene instead of re-painting every node. Pixel-identical to a direct paint.
    editor.setOffscreenFactory((w, h) => {
      const off =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
      return { canvas: off as unknown as { width: number; height: number }, ctx: off.getContext('2d') as unknown as Ctx2D };
    });

    let raf = 0;
    let flowTimer = 0;
    let lastFlowPaint = 0;
    const dpr = (): number => Math.max(1, Math.min(3, Math.floor(window.devicePixelRatio || 1)));

    const paint = (): void => {
      raf = 0;
      const rect = host.getBoundingClientRect();
      const now = performance.now();
      editor.render(ctx, rect.width, rect.height, dpr(), true, now);
      lastFlowPaint = now;
      if (editor.isFlowAnimating() || editor.isAnimating() || editor.hasAnimatedSelection() || editor.isShimmering()) armFlow(); // keep ticking while flow, a tween, the selection halo/marching-ants, or the idle shimmer is live
    };
    const armFlow = (): void => {
      clearTimeout(flowTimer);
      const cap = editor.flowConfig().maxFps;
      if (!cap || cap <= 0) { schedule(); return; }
      const wait = Math.max(0, 1000 / cap - (performance.now() - lastFlowPaint));
      flowTimer = setTimeout(schedule, wait) as unknown as number;
    };
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      editor.setViewport(rect.width, rect.height);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = Math.floor(rect.width * dpr());
      canvas.height = Math.floor(rect.height * dpr());
      schedule();
    };

    // repaint whenever any render-affecting signal changes
    const stopReaction = effect(() => {
      editor.sceneIndex.version.get();
      editor.cameraAtom.get();
      editor.themeAtom.get();
      editor.selectedAtom.get();
      editor.hoveredAtom.get();
      editor.marqueeAtom.get();
      editor.connectDraftAtom.get();
      editor.createPreviewAtom.get();
      editor.editingAtom.get();
      editor.overlaysAtom.get();
      editor.viewportAtom.get();
      editor.snapGuidesAtom.get();
      editor.flowConfigAtom.get();
      editor.reducedMotionAtom.get();
      editor.idleShimmerAtom.get(); // wake an idle rAF loop when setIdleShimmer(true) flips on/off post-mount
      editor.animationEpochAtom.get(); // wake an idle rAF loop when animate() starts a standalone tween
      schedule();
    });

    // honor OS prefers-reduced-motion; the headless core can't detect it, so feed it in
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    editor.setReducedMotion(mq.matches);
    const onReducedMotion = (): void => editor.setReducedMotion(mq.matches);
    mq.addEventListener('change', onReducedMotion);

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // ---- pointer / wheel / keyboard ----
    let panning = false;
    let spaceDown = false;
    let lastPan = { x: 0, y: 0 };
    // Release-velocity sample (screen px/ms) for momentum panning — see `editor.startPanMomentum`.
    let panVel = { x: 0, y: 0 };
    let lastPanT = 0;

    // ---- touch: live pointers by id + two-finger pinch state ----
    // Only the PRIMARY pointer drives the active tool (mouse/pen are always primary; the first touch
    // is). A second touch starts a pinch (zoom + pan on the camera); the in-flight tool gesture is
    // cancelled so the first finger doesn't drag a node while the second zooms. `suppressTool` stays
    // true until all fingers lift, so a leftover finger after a pinch can't restart a drag.
    const pointers = new Map<number, TouchPoint>();
    let pinch: PinchSample | null = null;
    let suppressTool = false;

    // ---- keyboard authoring: connect-from-selection mode ----
    // State + logic live in the engine (editor.pendingConnectAtom + begin/step/commit/cancel), so any
    // host gets the flow; the announcement below is the only host-side (presentation) piece — it reads
    // the pending source from the atom and speaks the aria-live prompt.
    const announceConnect = (): void => {
      const src = editor.pendingConnectAtom.peek();
      if (!src) return;
      const rec = editor.store.peek(src);
      const label = (rec && 'label' in rec && rec.label?.trim()) || (rec && 'type' in rec ? rec.type : 'node');
      setSrMessage(fmt(messagesRef.current.host.connectPrompt, { label }));
    };
    // Drop a default node at the viewport center (Enter while the Create tool is active).
    const createAtViewportCenter = (): void => {
      const tool = editor.toolManager.current as { type?: string };
      const vp = editor.viewportAtom.peek();
      const world = editor.screenToWorld({ x: vp.w / 2, y: vp.h / 2 });
      const type = typeof tool.type === 'string' ? tool.type : editor.quickCreateType;
      if (type && editor.nodes.has(type)) {
        const util = editor.nodes.get(type);
        const size = util?.getDefaultSize?.(util?.getDefaultProps?.() ?? {}) ?? { w: 120, h: 56 };
        const id = editor.createNodeAt(type, { x: world.x - size.w / 2, y: world.y - size.h / 2, w: size.w, h: size.h });
        editor.select([id]);
      } else {
        const id = editor.quickCreateNode(world);
        if (id) editor.select([id]);
      }
    };
    // Open the context menu at the current selection (Shift+F10 / the Menu key).
    const openContextMenuFromKeyboard = (): void => {
      if (cmRef.current === false) return;
      const vp = editor.viewportAtom.peek();
      const sel = editor.selectedIdsArray();
      const soleTarget = sel.length === 1 ? (editor.sceneIndex.getItem(sel[0]!) ?? null) : null;
      const b = editor.selectionBounds();
      const anchorWorld: Vec2 = b
        ? { x: b.x + b.w / 2, y: b.y + b.h / 2 }
        : editor.screenToWorld({ x: vp.w / 2, y: vp.h / 2 });
      const s = worldToScreen(editor.camera, anchorWorld);
      setCtxMenu({ x: s.x, y: s.y, target: soleTarget });
    };

    // Cursor derives from the active tool (crosshair while placing/connecting/erasing); pan and the
    // space-pan override it. Kept in sync when the tool changes via the editor's `tool` event.
    const toolCursor = (): string => {
      const id = editor.currentToolId;
      return id === 'create' || id === 'connect' || id === 'eraser' ? 'crosshair' : 'default';
    };
    const restoreCursor = (): void => {
      if (!panning) canvas.style.cursor = spaceDown ? 'grab' : toolCursor();
    };
    canvas.style.cursor = toolCursor();
    const stopToolCursor = editor.on('tool', restoreCursor);

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const modsOf = (e: PointerEvent) => ({
      button: e.button,
      shift: e.shiftKey,
      meta: e.metaKey || e.ctrlKey,
      alt: e.altKey,
      // Coarse (touch) pointers get a fatter hit radius so fat-finger taps still land on thin edges
      // and small nodes; mouse/pen keep the core default.
      tolerance: e.pointerType === 'touch' ? TOUCH_HIT_TOL : undefined,
    });

    const onPointerDown = (e: PointerEvent): void => {
      host.focus({ preventScroll: true }); // route keyboard (Tab traversal, shortcuts) to the canvas
      // setPointerCapture throws for a stale/synthetic pointerId (seen with some touch stacks); a throw
      // here would trip the zero-console-errors gate, so guard it.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* non-capturable pointer — ignore */ }
      // Any new gesture (pan or otherwise, e.g. a node grab) must cancel a still-gliding momentum-pan
      // tween — otherwise its residual panByScreen deltas keep stacking on top of the live drag and
      // the camera outruns the cursor. Cancel unconditionally, before branching on gesture kind.
      editor.cancelPanMomentum();
      pointers.set(e.pointerId, local(e));
      // Second touch → pinch: cancel any in-flight tool gesture (so the first finger stops dragging)
      // and begin two-finger zoom/pan. `suppressTool` holds until every finger lifts.
      if (e.pointerType === 'touch' && pointers.size >= 2) {
        editor.toolManager.exitActiveTool();
        suppressTool = true;
        pinch = pinchSample([...pointers.values()]);
        return;
      }
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        panning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        panVel = { x: 0, y: 0 }; // fresh pan shouldn't inherit a stale velocity from a prior gesture
        lastPanT = performance.now(); // fresh gesture's first onPointerMove computes dt against this
        canvas.style.cursor = 'grabbing';
        return;
      }
      // Only the primary pointer drives a tool; a non-primary touch never reaches the tool (its down is
      // recorded above so a later second finger can start a pinch).
      if (e.isPrimary) editor.pointerDown(local(e), modsOf(e));
    };
    const onPointerMove = (e: PointerEvent): void => {
      // Two-finger pinch: map finger spread → zoom and midpoint travel → pan. Runs before every other
      // branch so a leftover single-finger move can't leak into the tool mid-pinch.
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e));
      if (pinch && pointers.size >= 2) {
        const next = pinchSample([...pointers.values()]);
        const d = pinchDelta(pinch, next);
        if (d.panDx !== 0 || d.panDy !== 0) editor.panByScreen(d.panDx, d.panDy);
        if (d.factor !== 1) editor.zoomBy(d.factor, next.mid);
        pinch = next;
        return;
      }
      if (suppressTool) return; // a single finger left over from a pinch must not drive the tool
      if (panning) {
        const now = performance.now();
        const dt = Math.max(1, now - lastPanT);
        panVel = { x: (e.clientX - lastPan.x) / dt, y: (e.clientY - lastPan.y) / dt };
        lastPanT = now;
        editor.panByScreen(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!e.isPrimary) return; // ignore non-primary touch moves (only the primary drives the tool)
      editor.pointerMove(local(e), modsOf(e));
    };
    const onPointerUp = (e: PointerEvent): void => {
      const wasTouch = e.pointerType === 'touch';
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) pinch = null;
      if (pointers.size === 0) suppressTool = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured — ignore */ }
      if (panning) {
        panning = false;
        editor.startPanMomentum(panVel.x, panVel.y);
        restoreCursor();
        return;
      }
      // Don't deliver a tool pointer-up for a pinch finger or a non-primary touch.
      if (suppressTool || (wasTouch && !e.isPrimary)) return;
      editor.pointerUp(local(e), modsOf(e));
    };
    const onPointerCancel = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) suppressTool = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured — ignore */ }
      if (panning) { panning = false; restoreCursor(); }
    };
    const onDblClick = (e: MouseEvent): void => {
      editor.doubleClick(local(e), { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey });
    };
    const onContextMenu = (e: MouseEvent): void => {
      if (cmRef.current === false) return;
      e.preventDefault();
      const world = editor.screenToWorld(local(e));
      const target = editor.sceneIndex.hitTest(world, 6 / editor.camera.z);
      if (target && !editor.isSelected(target.id)) editor.select([target.id]);
      const hostRect = host.getBoundingClientRect();
      setCtxMenu({ x: e.clientX - hostRect.left, y: e.clientY - hostRect.top, target });
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Same bug class as `onPointerDown`: a still-gliding momentum-pan tween's residual `panByScreen`
      // deltas must not stack on top of a wheel-driven pan/zoom, or the camera outruns the input.
      editor.cancelPanMomentum();
      if (e.ctrlKey || e.metaKey) {
        editor.zoomBy(Math.exp(-e.deltaY * 0.0016), local(e));
      } else {
        editor.panByScreen(-e.deltaX, -e.deltaY);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceDown = true;
        if (!panning) canvas.style.cursor = 'grab';
        return;
      }
      // ---- connect-from-selection: while active, Tab/arrows pick the target and Enter commits an
      //      edge from the source; Escape cancels. Reuses the reading-order traversal (selectNextNode). ----
      if (editor.pendingConnectAtom.peek()) {
        if (e.key === 'Escape') { e.preventDefault(); editor.cancelPendingConnect(); setSrMessage(''); return; }
        if (e.key === 'Enter') { e.preventDefault(); editor.commitPendingConnect(); setSrMessage(''); return; }
        if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const dir = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
          editor.stepPendingConnect(dir);
          announceConnect(); // wins over the plain selection announcement fired by stepPendingConnect
          return;
        }
      }
      // ---- context menu from the keyboard (Shift+F10 or the dedicated Menu key), anchored at the
      //      selection (WCAG 2.1.1: menu must be reachable without a pointer). ----
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        openContextMenuFromKeyboard();
        return;
      }
      // ---- Tab / Shift+Tab: cycle the selection through nodes, but ONLY when the canvas owns
      //      focus. Elsewhere (toolbar, panels) Tab keeps its normal DOM focus-move behavior. ----
      if (e.key === 'Tab') {
        const t = e.target as HTMLElement | null;
        const inField =
          !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (!inField && document.activeElement === host) {
          e.preventDefault();
          editor.selectNextNode(e.shiftKey ? -1 : 1);
        }
        return;
      }
      // Keybindings stay here; the ACTION is dispatched through the shared command registry
      // (editor.commands, installed by the core) so the host, command palette, and context menu run
      // the exact same code and honor each command's `enabled` guard.
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void editor.execute(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        void editor.execute('redo');
        return;
      }

      // ---- zoom shortcuts (use e.code so they're layout-independent; preventDefault stops the
      //      browser's own page zoom so the canvas zooms instead) ----
      if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); void editor.execute('zoomIn'); return; }
      if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) { e.preventDefault(); void editor.execute('zoomOut'); return; }
      if (meta && (e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); editor.zoomBy(1 / editor.camera.z); return; } // reset to 100% (no command)
      if (!meta && e.shiftKey && e.code === 'Digit1') { e.preventDefault(); void editor.execute('zoomToFit'); return; }
      if (!meta && e.shiftKey && e.code === 'Digit2') { e.preventDefault(); editor.zoomToSelection(); return; } // no command

      if (editor.editingAtom.peek()) return; // let the textarea handle keys

      // ---- keyboard authoring ----
      // Enter/F2 edits the sole selection's label; Enter with the Create tool active drops a node at
      // the viewport center.
      if (e.key === 'Enter' || e.key === 'F2') {
        if (e.key === 'Enter' && editor.currentToolId === 'create') {
          e.preventDefault();
          createAtViewportCenter();
          return;
        }
        const sel = editor.selectedIdsArray();
        if (sel.length === 1) { e.preventDefault(); editor.beginEdit(sel[0]!); return; }
        if (e.key === 'F2') { e.preventDefault(); return; }
      }
      // 'c' begins connect-from-selection when exactly one connectable node is selected.
      if (!meta && (e.key === 'c' || e.key === 'C') && document.activeElement === host) {
        if (editor.beginConnectFromSelection()) {
          e.preventDefault();
          announceConnect();
          return;
        }
      }
      // ---- Escape when nothing is selected/editing exits the canvas so keyboard focus is never
      //      trapped (WCAG 2.1.2). With a selection, Escape falls through to clear it first; a second
      //      Escape (now empty) then exits. ----
      if (e.key === 'Escape' && document.activeElement === host && editor.selectedIdsArray().length === 0) {
        host.blur();
        return;
      }

      // ---- arrow-key nudge: 1px, or 10px with Shift ----
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // A focused form control (Properties number field / slider / select, or any host input) must
        // handle its OWN arrow keys — don't nudge the selection or preventDefault out from under it.
        // This is a window listener, so without this guard a selected node would steal the arrows.
        const tgt = e.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
        const sel = editor.selectedIdsArray();
        if (sel.length) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          editor.nudge(sel, dx, dy);
        } else if (document.activeElement === host) {
          // Nothing selected + canvas focused → start keyboard traversal (Up/Left = prev, Down/Right = next).
          e.preventDefault();
          editor.selectNextNode(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }

      editor.keyDown({ key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceDown = false;
        restoreCursor();
      }
    };
    // System-clipboard paste → image/text node. The INTERNAL clipboard (Cmd/Ctrl+C on nodes) takes
    // priority: its Cmd/Ctrl+V is handled in the tool key path, so we skip when it has content.
    const onPaste = (e: ClipboardEvent): void => {
      if (editor.hasClipboard()) return;
      if (editor.editingAtom.peek()) return; // editing a label → let the textarea paste
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // a real field
      // 'host' scope: the paste listener is on window, so ignore pastes unless this editor's host owns
      // focus — otherwise pasting into another editor / page region would drop a node into this one.
      if (keyScope === 'host' && !host.contains(document.activeElement)) return;
      const consumed = pasteFromSystem(editor, e.clipboardData, {
        ...(imageTypeRef.current ? { imageNodeType: imageTypeRef.current } : {}),
        ...(textTypeRef.current ? { textNodeType: textTypeRef.current } : {}),
      });
      if (consumed) e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // Keyboard shortcuts attach to the host div ('host', default — fires only while this editor holds
    // focus) or to window ('window', legacy app-wide). Paste stays a window listener in both scopes.
    if (keyScope === 'window') {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    } else {
      host.addEventListener('keydown', onKeyDown);
      host.addEventListener('keyup', onKeyUp);
    }
    window.addEventListener('paste', onPaste);

    return () => {
      unregisterCanvas(editor);
      editor.setOffscreenFactory(null);
      ro.disconnect();
      stopReaction();
      stopToolCursor();
      cancelAnimationFrame(raf);
      clearTimeout(flowTimer);
      mq.removeEventListener('change', onReducedMotion);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      if (keyScope === 'window') {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      } else {
        host.removeEventListener('keydown', onKeyDown);
        host.removeEventListener('keyup', onKeyUp);
      }
      window.removeEventListener('paste', onPaste);
    };
  }, [editor]);

  return (
    <div
      ref={hostRef}
      className={className}
      data-nodus-ui=""
      role="application"
      aria-label={m.host.canvasLabel}
      tabIndex={0}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none' }} />
      <EditOverlay editor={editor} messages={messages} />
      {/* visually-hidden aria-live region: announces selection changes for screen readers, since
          selection is otherwise conveyed only by the canvas paint. */}
      <div
        aria-live="polite"
        data-testid="nodus-selection-live"
        style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 }}
      >
        {srMessage}
      </div>
      {contextMenu !== false && ctxMenu && (
        <NodusContextMenu
          editor={editor}
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          onClose={() => setCtxMenu(null)}
          messages={messages}
          {...(contextMenuItems ? { items: contextMenuItems(editor, ctxMenu.target) } : {})}
          {...(contextMenuExtendItems ? { extendItems: contextMenuExtendItems } : {})}
        />
      )}
    </div>
  );
});

/**
 * The reading-order aria-live announcement for a selection change: `''` for an empty selection, the
 * localized "{label} — {i} of {n}" for a single object (index in the same y→x→id reading order the
 * keyboard traversal uses), and the localized count for a multi-selection. Local (not exported) — the
 * public surface is pinned.
 */
function selectionAnnouncement(editor: Editor, ids: Id[], hostMessages: ReactMessages['host']): string {
  if (ids.length === 0) return '';
  if (ids.length > 1) return fmt(hostMessages.selectionMulti, { count: ids.length });
  const id = ids[0]!;
  const rec = editor.store.peek(id);
  if (!rec) return '';
  const label = ('label' in rec && rec.label?.trim()) || ('type' in rec ? rec.type : 'object');
  // Index only among nodes (the traversable set); edges announce as "1 of 1".
  const ordered = editor.store
    .nodes()
    .slice()
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x !== b.x ? a.x - b.x : a.id < b.id ? -1 : 1));
  const i = ordered.findIndex((n) => n.id === id);
  return i >= 0
    ? fmt(hostMessages.selectionAnnounce, { label, i: i + 1, n: ordered.length })
    : fmt(hostMessages.selectionAnnounce, { label, i: 1, n: 1 });
}

/** Arc-length midpoint of a world-space polyline (an edge route). Never NaN: falls back to the origin
 *  for an empty route and the sole point for a one-point route. */
function polylineMidpoint(pts: readonly Vec2[]): Vec2 {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= half) {
      const t = seg === 0 ? 0 : half / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    half -= seg;
  }
  return pts[pts.length - 1]!;
}

/** Inline label editor: a positioned textarea tracking a node's world→screen box, or — for an edge —
 *  centered on the routed-polyline midpoint (a node box would resolve to NaN for an edge record). */
function EditOverlay({ editor, messages }: { editor: Editor; messages?: DeepPartial<ReactMessages> }): ReactElement | null {
  const editingId = useValue(() => editor.editingAtom.get());
  const camera = useValue(() => editor.cameraAtom.get());
  // subscribe to route/geometry changes so the edge-label box tracks reflow while open
  useValue(() => editor.sceneIndex.version.get());
  const hostMsg = useMessages(editor, messages).host;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!editingId) return;
    const rec = editor.store.peek(editingId) as NodeRecord | undefined;
    setValue(rec?.label ?? '');
    const t = setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [editingId, editor]);

  if (!editingId) return null;
  const rec = editor.store.peek(editingId);
  if (!rec) return null;

  const theme = editor.themeAtom.peek();
  const multiline = editor.isMultilineEdit(editingId);
  const fontPx = theme.typography.size * camera.z;

  let left: number;
  let top: number;
  let w: number;
  let h: number;
  if (rec.typeName === 'edge') {
    const route = editor.sceneIndex.getItem(editingId)?.route ?? [];
    const s = worldToScreen(camera, polylineMidpoint(route));
    w = 120;
    h = Math.max(20, fontPx + 8);
    left = s.x - w / 2;
    top = s.y - h / 2;
  } else {
    const n = rec as NodeRecord;
    const tl = worldToScreen(camera, { x: n.x, y: n.y });
    left = tl.x;
    top = tl.y;
    w = n.w * camera.z;
    h = n.h * camera.z;
  }

  return (
    <textarea
      ref={taRef}
      value={value}
      aria-label={hostMsg.editLabel}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !multiline) {
          e.preventDefault();
          editor.commitEdit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          editor.cancelEdit();
        }
        e.stopPropagation();
      }}
      onBlur={() => editor.commitEdit(value)}
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        resize: 'none',
        border: `1px solid ${theme.palette.accent ?? '#3b82f6'}`,
        borderRadius: (theme.radii.node ?? 6) * camera.z,
        background: theme.canvas.fill,
        color: theme.states.solid?.text ?? '#e5e5e5',
        font: `${fontPx}px ${theme.typography.fontFamily}`,
        textAlign: multiline ? 'left' : 'center',
        lineHeight: multiline ? 1.3 : `${h}px`,
        padding: multiline ? '4px' : 0,
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}
