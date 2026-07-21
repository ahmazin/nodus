/**
 * `<Nodus>` — the React host. Mounts a canvas, drives a signal-reactive rAF render loop, forwards
 * pointer/wheel/keyboard to the editor's tools, and hosts the inline text-edit overlay. No engine
 * logic lives here; all behavior is delegated to the `Editor`. The package barrel (`index.tsx`)
 * re-exports this plus the panels/ui surface.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useValue } from './use-value.js';
import { registerCanvas, unregisterCanvas } from './canvas-registry.js';
import {
  effect,
  worldToScreen,
  type Ctx2D,
  type Editor,
  type NodeRecord,
  type RenderItem,
} from '@nodus/core';
import { NodusContextMenu } from './context-menu.js';
import { injectGlobalStyles } from './ui/global-styles.js';
import { pasteFromSystem } from './clipboard.js';

export interface NodusProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
  /** Show the built-in right-click context menu (default true). */
  contextMenu?: boolean;
  /** Node type to insert when an image is pasted from the system clipboard (e.g. `'diagram.image'`).
   *  Omit to ignore pasted images. */
  imageNodeType?: string;
  /** Node type to insert when plain text is pasted from the system clipboard. Omit to ignore text. */
  textNodeType?: string;
}

export function Nodus({ editor, className, style, contextMenu = true, imageNodeType, textNodeType }: NodusProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: RenderItem | null } | null>(null);
  const cmRef = useRef(contextMenu);
  cmRef.current = contextMenu;
  // Paste target types are read lazily inside the (editor-only-deps) effect, mirroring `cmRef`.
  const imageTypeRef = useRef(imageNodeType);
  imageTypeRef.current = imageNodeType;
  const textTypeRef = useRef(textNodeType);
  textTypeRef.current = textNodeType;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    registerCanvas(editor, canvas);
    injectGlobalStyles(); // idempotent: focus rings + chrome base styles, app-wide

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
      if (editor.isFlowAnimating() || editor.isAnimating() || editor.hasAnimatedSelection()) armFlow(); // keep ticking while flow, a tween, or the selection halo/marching-ants is live
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
    });

    const onPointerDown = (e: PointerEvent): void => {
      host.focus({ preventScroll: true }); // route keyboard (Tab traversal, shortcuts) to the canvas
      canvas.setPointerCapture(e.pointerId);
      // Any new gesture (pan or otherwise, e.g. a node grab) must cancel a still-gliding momentum-pan
      // tween — otherwise its residual panByScreen deltas keep stacking on top of the live drag and
      // the camera outruns the cursor. Cancel unconditionally, before branching on gesture kind.
      editor.cancelPanMomentum();
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        panning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        panVel = { x: 0, y: 0 }; // fresh pan shouldn't inherit a stale velocity from a prior gesture
        lastPanT = performance.now(); // fresh gesture's first onPointerMove computes dt against this
        canvas.style.cursor = 'grabbing';
        return;
      }
      editor.pointerDown(local(e), modsOf(e));
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (panning) {
        const now = performance.now();
        const dt = Math.max(1, now - lastPanT);
        panVel = { x: (e.clientX - lastPan.x) / dt, y: (e.clientY - lastPan.y) / dt };
        lastPanT = now;
        editor.panByScreen(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
        return;
      }
      editor.pointerMove(local(e), modsOf(e));
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (panning) {
        panning = false;
        editor.startPanMomentum(panVel.x, panVel.y);
        restoreCursor();
        return;
      }
      editor.pointerUp(local(e), modsOf(e));
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
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        editor.redo();
        return;
      }

      // ---- zoom shortcuts (use e.code so they're layout-independent; preventDefault stops the
      //      browser's own page zoom so the canvas zooms instead) ----
      if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); editor.zoomBy(1.2); return; }
      if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) { e.preventDefault(); editor.zoomBy(1 / 1.2); return; }
      if (meta && (e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); editor.zoomBy(1 / editor.camera.z); return; } // reset to 100%
      if (!meta && e.shiftKey && e.code === 'Digit1') { e.preventDefault(); editor.zoomToFit(); return; }
      if (!meta && e.shiftKey && e.code === 'Digit2') { e.preventDefault(); editor.zoomToSelection(); return; }

      if (editor.editingAtom.peek()) return; // let the textarea handle keys

      // ---- arrow-key nudge: 1px, or 10px with Shift ----
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
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
      const consumed = pasteFromSystem(editor, e.clipboardData, {
        ...(imageTypeRef.current ? { imageNodeType: imageTypeRef.current } : {}),
        ...(textTypeRef.current ? { textNodeType: textTypeRef.current } : {}),
      });
      if (consumed) e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
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
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [editor]);

  return (
    <div
      ref={hostRef}
      className={className}
      data-nodus-ui=""
      role="application"
      aria-label="Diagram canvas — Tab to move between nodes, arrow keys to nudge"
      tabIndex={0}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none' }} />
      <EditOverlay editor={editor} />
      {contextMenu !== false && ctxMenu && (
        <NodusContextMenu editor={editor} x={ctxMenu.x} y={ctxMenu.y} target={ctxMenu.target} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

/** Inline label editor: a positioned textarea tracking the node's world→screen transform. */
function EditOverlay({ editor }: { editor: Editor }): ReactElement | null {
  const editingId = useValue(() => editor.editingAtom.get());
  const camera = useValue(() => editor.cameraAtom.get());
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
  const rec = editor.store.peek(editingId) as NodeRecord | undefined;
  if (!rec) return null;

  const tl = worldToScreen(camera, { x: rec.x, y: rec.y });
  const w = rec.w * camera.z;
  const h = rec.h * camera.z;
  const theme = editor.themeAtom.peek();
  const multiline = editor.isMultilineEdit(editingId);

  return (
    <textarea
      ref={taRef}
      value={value}
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
        left: tl.x,
        top: tl.y,
        width: w,
        height: h,
        resize: 'none',
        border: `1px solid ${theme.palette.accent ?? '#3b82f6'}`,
        borderRadius: (theme.radii.node ?? 6) * camera.z,
        background: theme.canvas.fill,
        color: theme.states.solid?.text ?? '#e5e5e5',
        font: `${theme.typography.size * camera.z}px ${theme.typography.fontFamily}`,
        textAlign: multiline ? 'left' : 'center',
        lineHeight: multiline ? 1.3 : `${h}px`,
        padding: multiline ? '4px' : 0,
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}
