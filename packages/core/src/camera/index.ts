/**
 * Camera math. `camera.x/y` is the world point at the viewport's top-left; `camera.z` is zoom.
 * DPR is folded into the render matrix so `draw()` always works in world units and never sees
 * zoom or device pixels.
 */

import type { Box, Camera, Mat2D, Vec2 } from '../model.js';

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

export function worldToScreen(cam: Camera, p: Vec2): Vec2 {
  return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z };
}

export function screenToWorld(cam: Camera, p: Vec2): Vec2 {
  return { x: p.x / cam.z + cam.x, y: p.y / cam.z + cam.y };
}

/**
 * The transform used to draw world coordinates onto a device-pixel canvas backing store:
 * `deviceX = (worldX - cam.x) * z * dpr`.
 */
export function renderMatrix(cam: Camera, dpr: number): Mat2D {
  const s = cam.z * dpr;
  return [s, 0, 0, s, -cam.x * s, -cam.y * s];
}

/** The world-space rectangle currently visible for a viewport of CSS size `w`×`h`. */
export function viewportWorldBounds(cam: Camera, cssW: number, cssH: number): Box {
  return { x: cam.x, y: cam.y, w: cssW / cam.z, h: cssH / cam.z };
}

/** Zoom by `factor` while keeping the world point under `screenPoint` fixed on screen. */
export function zoomAt(cam: Camera, screenPoint: Vec2, factor: number, min = 0.05, max = 40): Camera {
  const z = clamp(cam.z * factor, min, max);
  const worldBefore = screenToWorld(cam, screenPoint);
  // after changing z, solve for x/y so worldBefore maps back to screenPoint
  const x = worldBefore.x - screenPoint.x / z;
  const y = worldBefore.y - screenPoint.y / z;
  return { x, y, z };
}

export function panByScreen(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { x: cam.x - dxScreen / cam.z, y: cam.y - dyScreen / cam.z, z: cam.z };
}

/** Fit `bounds` into a `cssW`×`cssH` viewport with padding, returning the camera to use. */
export function fitBox(bounds: Box, cssW: number, cssH: number, padding = 40, max = 40): Camera {
  if (bounds.w <= 0 || bounds.h <= 0) return { x: bounds.x, y: bounds.y, z: 1 };
  const z = clamp(
    Math.min((cssW - padding * 2) / bounds.w, (cssH - padding * 2) / bounds.h),
    0.05,
    max,
  );
  const x = bounds.x - (cssW / z - bounds.w) / 2;
  const y = bounds.y - (cssH / z - bounds.h) / 2;
  return { x, y, z };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
