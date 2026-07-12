/** A minimap overlay: a scaled view of the whole scene with a draggable viewport indicator. */
import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { effect, resolveTokens, type Editor } from '@nodus/core';

export interface MinimapProps {
  editor: Editor;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

export function Minimap({ editor, width = 200, height = 140, className, style }: MinimapProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const pad = 10;

    const fit = () => {
      const b = editor.sceneIndex.contentBounds();
      if (!b) return null;
      const s = Math.min((width - 2 * pad) / b.w, (height - 2 * pad) / b.h) || 1;
      const ox = pad + (width - 2 * pad - b.w * s) / 2 - b.x * s;
      const oy = pad + (height - 2 * pad - b.h * s) / 2 - b.y * s;
      return { s, ox, oy };
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const theme = editor.themeAtom.peek();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme.canvas.fill;
      ctx.fillRect(0, 0, width, height);
      const f = fit();
      if (!f) return;
      for (const item of editor.sceneIndex.paintOrder()) {
        if (item.kind !== 'node') continue;
        const a = item.aabb;
        const tokens = resolveTokens(theme, item.record.visual, item.record.type, item.record.style);
        ctx.fillStyle = tokens.stroke;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(a.x * f.s + f.ox, a.y * f.s + f.oy, Math.max(2, a.w * f.s), Math.max(2, a.h * f.s));
      }
      ctx.globalAlpha = 1;
      const vp = editor.worldViewport();
      ctx.strokeStyle = theme.palette.accent ?? '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vp.x * f.s + f.ox, vp.y * f.s + f.oy, vp.w * f.s, vp.h * f.s);
    };

    const stop = effect(() => {
      editor.sceneIndex.version.get();
      editor.cameraAtom.get();
      editor.viewportAtom.get();
      editor.themeAtom.get();
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
    const onDown = (e: PointerEvent) => { dragging = true; canvas.setPointerCapture(e.pointerId); recenter(e); };
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

  return <canvas ref={canvasRef} className={className} style={{ width, height, display: 'block', cursor: 'pointer', ...style }} />;
}
