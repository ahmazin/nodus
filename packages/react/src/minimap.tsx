/** A minimap overlay: a scaled view of the whole scene with a draggable viewport indicator. */
import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { effect, type Box, type Editor } from '@ahmazin/core';
import { modeOfTheme, uiTokensFor, useUiTokens } from './ui/tokens.js';

/**
 * A tiny version-keyed memo. Returns a getter that recomputes only when the passed `version` differs
 * from the last call — so panning the camera (which doesn't bump the scene version) reuses the cached
 * value instead of re-scanning every item. Pure and framework-free, so it's unit-testable directly.
 */
export function createVersionCache<T>(): (version: number, compute: () => T) => T {
  let has = false;
  let cachedVersion = -1;
  let cachedValue: T;
  return (version, compute) => {
    if (has && version === cachedVersion) return cachedValue;
    cachedValue = compute();
    cachedVersion = version;
    has = true;
    return cachedValue;
  };
}

export interface MinimapProps {
  editor: Editor;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

export function Minimap({ editor, width = 200, height = 140, className, style }: MinimapProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useUiTokens(editor);
  // Persist the bounds cache across renders/redraws; contentBounds() spreads the whole item map, so
  // caching it by scene version keeps a drag (many pointermove → recenter → fit calls) allocation-free.
  const boundsCacheRef = useRef<((version: number, compute: () => Box | null) => Box | null) | null>(null);
  if (!boundsCacheRef.current) boundsCacheRef.current = createVersionCache<Box | null>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const pad = 10;
    const boundsCache = boundsCacheRef.current!;

    const contentBounds = (): Box | null =>
      boundsCache(editor.sceneIndex.version.peek(), () => editor.sceneIndex.contentBounds());

    const fit = () => {
      const b = contentBounds();
      if (!b) return null;
      const s = Math.min((width - 2 * pad) / b.w, (height - 2 * pad) / b.h) || 1;
      const ox = pad + (width - 2 * pad - b.w * s) / 2 - b.x * s;
      const oy = pad + (height - 2 * pad - b.h * s) / 2 - b.y * s;
      return { s, ox, oy };
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Derive UI tokens fresh from the (subscribed) theme atom so a mode flip repaints with the
      // right palette — no stale render-closure. Node/viewport colors come from tokens, not the
      // canvas Theme, to match the DOM chrome.
      const tk = uiTokensFor(modeOfTheme(editor.themeAtom.peek()));
      const selected = editor.selectedAtom.peek();
      // Transparent background so the frosted wrapper div (glass + backdrop-blur) shows through;
      // the node dots + viewport rect below still paint on top.
      ctx.clearRect(0, 0, width, height);
      const f = fit();
      if (!f) return;
      ctx.globalAlpha = 0.85;
      for (const item of editor.sceneIndex.paintOrder()) {
        if (item.kind !== 'node') continue;
        const a = item.aabb;
        ctx.fillStyle = selected.has(item.record.id) ? tk.color.accent : tk.color.textFaint;
        ctx.fillRect(a.x * f.s + f.ox, a.y * f.s + f.oy, Math.max(2, a.w * f.s), Math.max(2, a.h * f.s));
      }
      ctx.globalAlpha = 1;
      const vp = editor.worldViewport();
      const vx = vp.x * f.s + f.ox;
      const vy = vp.y * f.s + f.oy;
      const vw = vp.w * f.s;
      const vh = vp.h * f.s;
      ctx.fillStyle = tk.color.selection;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeStyle = tk.color.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    };

    const stop = effect(() => {
      editor.sceneIndex.version.get();
      editor.cameraAtom.get();
      editor.viewportAtom.get();
      editor.themeAtom.get();
      editor.selectedAtom.get();
      draw();
    });

    let dragging = false;
    const recenter = (e: PointerEvent) => {
      const f = fit();
      if (!f) return;
      const r = canvas.getBoundingClientRect();
      const wx = (e.clientX - r.left - f.ox) / f.s;
      const wy = (e.clientY - r.top - f.oy) / f.s;
      const cam = editor.camera;
      const vp = editor.viewportAtom.peek();
      editor.setCamera({ x: wx - vp.w / (2 * cam.z), y: wy - vp.h / (2 * cam.z), z: cam.z });
    };
    const onDown = (e: PointerEvent) => {
      // Same bug class as the main canvas's `onPointerDown`: a still-gliding momentum-pan tween's
      // residual `panByScreen` deltas must not stack on top of a minimap-driven recenter, or the camera
      // outruns the drag.
      editor.cancelPanMomentum();
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      recenter(e);
    };
    const onMove = (e: PointerEvent) => { if (dragging) recenter(e); };
    const onUp = () => { dragging = false; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);

    return () => {
      stop();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [editor, width, height]);

  return (
    <canvas
      ref={canvasRef}
      data-nodus-ui=""
      className={className}
      aria-label="Minimap — drag to pan the viewport"
      style={{
        width,
        height,
        display: 'block',
        cursor: 'pointer',
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.md,
        boxShadow: t.shadow.panel,
        background: 'transparent',
        ...style,
      }}
    />
  );
}
