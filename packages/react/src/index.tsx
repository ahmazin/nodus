/**
 * @nodus/react — a thin React binding. `<Nodus>` mounts a canvas, drives a signal-reactive rAF
 * render loop, forwards pointer/wheel/keyboard to the editor's tools, and hosts the inline
 * text-edit overlay. `useValue` bridges any core signal into React. No engine logic lives here.
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
  type Dispose,
  type Editor,
  type Id,
  type NodeRecord,
  type RenderItem,
} from '@nodus/core';
import { NodusContextMenu } from './context-menu.js';

export { useValue } from './use-value.js';

export interface NodusProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
  /** Show the built-in right-click context menu (default true). */
  contextMenu?: boolean;
}

export function Nodus({ editor, className, style, contextMenu = true }: NodusProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: RenderItem | null } | null>(null);
  const cmRef = useRef(contextMenu);
  cmRef.current = contextMenu;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    registerCanvas(editor, canvas);

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
      if (editor.isFlowAnimating()) armFlow(); // keep ticking while flowing (throttled to maxFps)
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
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        panning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        return;
      }
      editor.pointerDown(local(e), modsOf(e));
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (panning) {
        editor.panByScreen(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
        return;
      }
      editor.pointerMove(local(e), modsOf(e));
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (panning) {
        panning = false;
        canvas.style.cursor = spaceDown ? 'grab' : 'default';
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
      if (editor.editingAtom.peek()) return; // let the textarea handle keys
      editor.keyDown({ key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceDown = false;
        if (!panning) canvas.style.cursor = 'default';
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      unregisterCanvas(editor);
      ro.disconnect();
      stopReaction();
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
    };
  }, [editor]);

  return (
    <div ref={hostRef} className={className} style={{ position: 'relative', overflow: 'hidden', ...style }}>
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

export { Minimap, type MinimapProps } from './minimap.js';
export { CommandPalette, defaultCommands, type Command, type CommandPaletteProps } from './command-palette.js';
export { NodusContextMenu, contextMenuItems, type MenuItem, type NodusContextMenuProps } from './context-menu.js';
export { Properties, type PropertiesProps } from './properties.js';
export { FlowControls, type FlowControlsProps } from './flow-controls.js';
export { FlowScaleEditor, type FlowScaleEditorProps } from './flow-scale-editor.js';
export { buildRampCss, DEFAULT_FLOW, DEFAULT_SCALE } from './flow-shared.js';
export { canCopyImage, copyImage, copyOrDownloadImage, downloadImage, renderPngBlob, type ExportMethod, type ExportResult, type ImageExportOptions } from './clipboard.js';
export { showToast } from './toast.js';
export { CloudIconPicker, type CloudIconPickerProps } from './cloud-icon-picker.js';
export { filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';

export type { Editor, Id };
