/**
 * A decoded raster image drawable via `Ctx2D.drawImage`. Structurally satisfied alike by a browser
 * `HTMLImageElement` / `ImageBitmap` and a headless `@napi-rs/canvas` `Image` (all expose numeric
 * `width`/`height`), so image nodes decode once and paint identically in both environments.
 */
export interface DrawableImage {
  readonly width: number;
  readonly height: number;
}

/**
 * `Ctx2D` — a structural subset of `CanvasRenderingContext2D`. Both a browser 2D context and a
 * headless Skia context (`@napi-rs/canvas`) satisfy it, so the exact same paint code runs in the
 * browser and in Node for tests / PNG export. Cast the real context to `Ctx2D` at the boundary.
 */
export interface Ctx2D {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    a0: number,
    a1: number,
    ccw?: boolean,
  ): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;

  fill(fillRule?: 'nonzero' | 'evenodd'): void;
  stroke(): void;
  clip(): void;

  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };

  /** Draw a decoded image into the destination rect (world coords). */
  drawImage(image: DrawableImage, dx: number, dy: number, dw: number, dh: number): void;
  /** Blit a source sub-rectangle of an image into a destination rect (both in the current space). Used
   *  1:1 (source size === dest size) for exact, resample-free copies between offscreen layers. */
  drawImage(
    image: DrawableImage,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  setLineDash(segments: number[]): void;

  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  lineDashOffset: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
}
