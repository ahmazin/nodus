# Canvas Signature — S3 Chrome & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Unify the chrome into one frosted-glass language that matches the now-premium canvas: translucent backdrop-blur on the top bar, left rail, right panel, zoom bar, and minimap; a button press-scale micro-interaction; toast icons per action; a slim bottom status bar (tool · live cursor world-coords · selection · zoom); and a dismissible empty-state onboarding card.

**Architecture:** Pure React/CSS — **no `@nodus-dev/core` changes**. Frosting is inline-style + two new additive design tokens (a translucent `glass` surface + a `blur` radius) with a solid-color fallback where `backdrop-filter` is unsupported. Status bar and empty-state are new React components reading existing editor atoms + a throttled `pointermove`→`screenToWorld` (app-side, no core change). Reduced-motion honored.

**Tech Stack:** TypeScript strict, React, inline styles, the `@nodus-dev/react` `UiTokens` design system, `playwright-core`/`scripts/browser-verify.mjs` for verification (no jsdom → S3 is browser-verified; only pure helpers get unit tests).

## Global Constraints

- `pnpm typecheck` after every task (the gate). No jsdom — visual/DOM behavior is **browser-verified** (`node scripts/browser-verify.mjs` against the running `pnpm dev` on :5188, which the lead runs; zero console errors is a hard gate). Pure helpers (coord formatting) get unit tests.
- **No `@nodus-dev/core` changes. No new dependencies.** Reuse the existing `UiTokens`, `icons.tsx` set (React) / raw SVG for toasts, `useValue`, `useCurrentTool`.
- **Frost fallback:** every frosted surface keeps a semi-opaque `glass` background so browsers without `backdrop-filter` still render a solid-ish panel (never transparent/unreadable). Always pair `backdropFilter` with `WebkitBackdropFilter`.
- **Reduced-motion:** the press-scale must be disabled under `prefers-reduced-motion` (the existing global reduced-motion block zeroes durations but NOT `transform` — add a `transform:none` there).
- Match existing token/style conventions (inline styles, `t.color.*`, `t.radius.*`). Don't restyle beyond the named surfaces.

## Key seams (from the audit)
- Frost targets (inline styles in `examples/browser/src/main.tsx`): header `:850`, left rail `:988`, right panel `:1029`, minimap wrapper `:1015`, `ZoomControls` container (`packages/react/src/ui/shell/ZoomControls.tsx:40`, accepts a `style` prop). Minimap canvas paints opaque `panel` fill (`packages/react/src/minimap.tsx:71`) — must go translucent for the wrapper blur to show.
- Frost recipe (mirror `command-palette.tsx:218`): `backdropFilter:'blur(Npx) saturate(1.4)'` + `WebkitBackdropFilter` + `background: <rgba>`.
- Tokens: `packages/react/src/ui/tokens.ts` — `UiTokens.color` (dark `:89`, light `:132`); no `glass`/`blur` today.
- Global CSS: `packages/react/src/ui/global-styles.ts` — buttons via `[data-nodus-ui] button`; primitive buttons set `data-nodus-ui` on the `<button>` itself (need `button[data-nodus-ui]` too); reduced-motion block at the `@media (prefers-reduced-motion)` rule.
- Toasts: `packages/react/src/toast.ts` `showToast(message, tone: 'ok'|'error', opts)` — raw DOM, text-only at `el.textContent = message`.
- Status bar data: `useCurrentTool(editor)` (event-based, `ui/shell`), `useValue(() => editor.cameraAtom.get().z)`, `useValue(() => editor.selectedAtom.get().size)`; cursor: throttled `pointermove` on the canvas wrapper div → `editor.screenToWorld({x: clientX-rect.left, y: clientY-rect.top})`.
- Empty-state: `useValue(() => (editor.sceneIndex.version.get(), editor.store.nodes().length))` === 0; localStorage key `nodus.onboarding.dismissed`. Mount in the canvas `position:relative` div (`main.tsx:996`).

---

## File Structure
- `packages/react/src/ui/tokens.ts` — MODIFY: add `glass` color + `blur` to `UiTokens` (dark + light).
- `packages/react/src/ui/global-styles.ts` — MODIFY: button press-scale + reduced-motion transform kill.
- `packages/react/src/toast.ts` — MODIFY: per-tone icon.
- `packages/react/src/minimap.tsx` — MODIFY: translucent canvas fill so the frosted wrapper shows.
- `examples/browser/src/main.tsx` — MODIFY: frost header/rail/panel/minimap-wrapper/zoom; mount status bar + empty-state.
- `examples/browser/src/status-bar.tsx` — CREATE: the status bar component + a pure `formatCoords` helper.
- `examples/browser/src/status-bar.test.ts` — CREATE: unit test for `formatCoords`.
- `examples/browser/src/empty-state.tsx` — CREATE: the onboarding card.
- `examples/browser/index.html` — MODIFY (if needed): press-scale for the app's raw header buttons.

---

### Task 1: Frosted-glass tokens (`glass` + `blur`)

**Files:** Modify `packages/react/src/ui/tokens.ts`. Test: none (data) — verified by typecheck + downstream use.

**Interfaces:**
- Produces: `UiTokens.color.glass: string` (translucent surface for frosting) and `UiTokens.blur: string` (CSS blur length). Dark: `glass: 'rgba(16,19,25,0.72)'`, `blur: '12px'`. Light: `glass: 'rgba(255,255,255,0.72)'`, `blur: '12px'`. Additive — existing tokens unchanged.

- [ ] **Step 1:** Add `glass: string;` to the `color` shape in the `UiTokens` interface (`tokens.ts` ~`:25-73`), and `blur: string;` at the top level of `UiTokens`.
- [ ] **Step 2:** Add `glass: 'rgba(16,19,25,0.72)'` to the dark `color` object (`:89`) and `blur: '12px'` to the dark token object; add `glass: 'rgba(255,255,255,0.72)'` to light (`:132`) and `blur: '12px'` to the light object.
- [ ] **Step 3:** `pnpm typecheck` — clean (any code constructing a `UiTokens` literal must now include the fields; if `uiTokensFor`/`toast.ts` build partial tokens, update them). Report to controller.

---

### Task 2: Frost the chrome (header, rail, panel, zoom, minimap)

**Files:** Modify `examples/browser/src/main.tsx`, `packages/react/src/minimap.tsx`. Verified in-browser.

**Interfaces:** Consumes `t.color.glass` + `t.blur` (Task 1). Each frosted surface swaps its solid `background: t.color.surface/panel` for `background: t.color.glass` + `backdropFilter: blur(${t.blur}) saturate(1.4)` + `WebkitBackdropFilter`. Minimap canvas fill goes translucent so the wrapper blur shows.

- [ ] **Step 1:** In `main.tsx`, for the header (`:850`), left rail (`:988`), right panel (`:1029`), and minimap wrapper (`:1015`): replace `background: t.color.surface` (or `panel` for the minimap wrapper) with:
```tsx
background: t.color.glass,
backdropFilter: `blur(${t.blur}) saturate(1.4)`,
WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
```
  Keep the existing `borderBottom`/`borderRight`/`borderLeft`/`boxShadow`.
- [ ] **Step 2:** Frost `ZoomControls` from the app by passing a `style` override where it's rendered (`main.tsx:1000` `<ZoomControls editor={editor} />` → add `style={{ background: t.color.glass, backdropFilter: \`blur(${t.blur}) saturate(1.4)\`, WebkitBackdropFilter: \`blur(${t.blur}) saturate(1.4)\` }}`). (`ZoomControls` spreads `style` last over its container.)
- [ ] **Step 3:** In `packages/react/src/minimap.tsx`, make the minimap background translucent so the frosted wrapper shows through: change the opaque background fill (`:70-71`, `ctx.fillStyle = tk.color.panel; ctx.fillRect(...)`) to a `ctx.clearRect(0,0,w,h)` (transparent) — the frosted wrapper div behind provides the surface. Keep the node dots + viewport rect drawing unchanged. (If a faint tint is wanted, fill with a low-alpha color instead of clearing — but transparent is simplest and lets the glass read.)
- [ ] **Step 4:** `pnpm typecheck`. Report to controller (browser verification batched by lead).

---

### Task 3: Button press-scale micro-interaction

**Files:** Modify `packages/react/src/ui/global-styles.ts` (+ `examples/browser/index.html` for the app's raw header buttons). Browser-verified.

**Interfaces:** Buttons scale to `0.97` on `:active` with a fast transition, disabled under reduced-motion.

- [ ] **Step 1:** In `global-styles.ts` CSS, add (after the `[data-nodus-ui] button` reset):
```css
[data-nodus-ui] button, button[data-nodus-ui] { transition: transform 80ms ease; }
[data-nodus-ui] button:active, button[data-nodus-ui]:active { transform: scale(0.97); }
```
  And in the existing `@media (prefers-reduced-motion: reduce)` block, add `transform: none !important;` to the `[data-nodus-ui] *` rule so the press-scale is disabled under reduced motion.
- [ ] **Step 2:** In `examples/browser/index.html`'s `<style>`, add the same press-scale for the app header's plain buttons (they have no `data-nodus-ui` ancestor). A scoped rule like `header button:active { transform: scale(0.97); }` + `header button { transition: transform 80ms ease; }`, and add `header button { transform: none !important; }` to the existing `@media (prefers-reduced-motion)` block there.
- [ ] **Step 3:** `pnpm typecheck`. Report to controller.

---

### Task 4: Toast icons

**Files:** Modify `packages/react/src/toast.ts`. Test: none headless (raw DOM) — browser/visual.

**Interfaces:** `showToast` prepends a small inline-SVG icon per tone (a check for `'ok'`, an alert/x for `'error'`), colored with the existing tone color `fg`.

- [ ] **Step 1:** In `toast.ts`, replace `el.textContent = message;` (`:51`) with structured children: build an icon `<span>`/inline `<svg>` (via `document.createElementNS('http://www.w3.org/2000/svg','svg')` with a checkmark path for `ok`, an alert-triangle/x for `error`, `width/height=15`, `stroke=currentColor`) plus a text `<span>` for the message; set the container to `display:inline-flex; align-items:center; gap:8px`. Icon inherits `fg` via `currentColor` (the container already sets `color:${fg}`). Keep `role`, tone color, animation, timing unchanged.
- [ ] **Step 2:** `pnpm typecheck`. Report to controller.

---

### Task 5: Status bar (tool · cursor coords · selection · zoom)

**Files:** Create `examples/browser/src/status-bar.tsx` + `examples/browser/src/status-bar.test.ts`; modify `examples/browser/src/main.tsx` (mount + cursor tracking). Pure `formatCoords` unit-tested; the rest browser-verified.

**Interfaces:**
- Produces: `export function formatCoords(p: { x: number; y: number } | null): string` — `'x  y'` rounded to integers, or `'—'` when null. `export function StatusBar({ editor, cursor }: { editor: Editor; cursor: {x:number;y:number} | null }): ReactElement` — a slim frosted footer showing: active tool (`useCurrentTool`), cursor world-coords (`formatCoords(cursor)`), selection count (`useValue(selectedAtom.size)`) + node count, and zoom % (`useValue(cameraAtom.z)` → `Math.round(z*100)%`).
- `main.tsx`: wrap the canvas div (`:996`) content so a throttled `pointermove` updates a `cursor` state (via `editor.screenToWorld({x: e.clientX - rect.left, y: e.clientY - rect.top})` using the wrapper's `getBoundingClientRect()`), and render `<StatusBar editor={editor} cursor={cursor} />` as a footer after the main row (`:1238`).

- [ ] **Step 1: Write the failing test** — `status-bar.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatCoords } from './status-bar.js';
describe('formatCoords', () => {
  it('rounds to integers with a separator', () => {
    expect(formatCoords({ x: 12.4, y: -7.8 })).toBe('12, -8');
  });
  it('shows a dash when null', () => {
    expect(formatCoords(null)).toBe('—');
  });
});
```
- [ ] **Step 2: Run — expect FAIL:** `pnpm exec vitest run examples/browser/src/status-bar.test.ts`
- [ ] **Step 3: Implement** `status-bar.tsx` — `formatCoords` (`p ? \`${Math.round(p.x)}, ${Math.round(p.y)}\` : '—'`) and the `StatusBar` component (frosted footer: `height:26`, `background:t.color.glass` + blur, `borderTop`, small `t.font.mono` coords, `t.color.textMuted` labels). Use `useCurrentTool`, `useValue`, `useUiTokens`.
- [ ] **Step 4:** Wire into `main.tsx`: a `const [cursor, setCursor] = useState<{x,y}|null>(null)`, a ref on the canvas wrapper div, a throttled `onPointerMove`/`onPointerLeave` (rAF or ~30ms throttle) computing world coords, and `<StatusBar editor={editor} cursor={cursor} />` after the main row. Give the footer a `data-testid="statusbar"`.
- [ ] **Step 5: Run — expect PASS** (`formatCoords` test) + `pnpm typecheck`. Report to controller.

---

### Task 6: Empty-state onboarding card

**Files:** Create `examples/browser/src/empty-state.tsx`; modify `examples/browser/src/main.tsx`. Browser-verified.

**Interfaces:**
- Produces: `export function EmptyState({ editor, onDismiss }: { editor: Editor; onDismiss: () => void }): ReactElement` — a centered frosted card (in the canvas overlay) with a title, one line of guidance, a couple of quick-action buttons (e.g. "Add a shape" via a tool, "⌘K commands", "Import"), and a dismiss "×". Shown only when the document has zero nodes AND not previously dismissed (localStorage `nodus.onboarding.dismissed`).
- `main.tsx`: `const nodeCount = useValue(...)` (already exists at `:599`); `const [onboardDismissed, setOnboardDismissed] = useState(() => localStorage.getItem('nodus.onboarding.dismissed') === '1')`; render `{nodeCount === 0 && !onboardDismissed && <EmptyState editor={editor} onDismiss={() => { localStorage.setItem('nodus.onboarding.dismissed','1'); setOnboardDismissed(true); }} />}` inside the canvas `position:relative` div (`:996`), absolutely centered, `zIndex:15`.

- [ ] **Step 1:** Create `empty-state.tsx` — the frosted centered card (`background:t.color.glass`+blur, `border`, `borderRadius:t.radius.lg`, `boxShadow:t.shadow.popover`, padding, max-width ~340), a `data-testid="empty-state"`, quick-action buttons wired to editor actions / the app's command handlers, and a dismiss button (`CloseIcon`). Respect reduced-motion (no entrance animation, or use the existing `.nd-pop` class which is reduced-motion-gated).
- [ ] **Step 2:** Wire into `main.tsx` (the `nodeCount === 0 && !onboardDismissed` gate + dismiss handler + localStorage). Ensure a template/import that adds nodes hides it (nodeCount>0), and dismiss persists across reloads.
- [ ] **Step 3:** `pnpm typecheck`. Report to controller.

---

## Final verification (whole plan — lead)

- [ ] `pnpm typecheck` clean; `pnpm test` whole suite green (incl. the new `formatCoords` test).
- [ ] **Browser drive:** `node scripts/browser-verify.mjs` against `pnpm dev` — zero console errors, all existing interactions still pass (frosting/status/empty-state must not break create/drag/undo/etc.).
- [ ] **Visual sign-off (screenshot):** a chrome-devtools/playwright screenshot of the app showing: frosted top bar/rail/panel/zoom/minimap, the status bar with live coords, and (on an empty doc) the onboarding card — sent to the user for the aesthetic acceptance gate. Confirm the empty-state hides once a node exists and the dismiss persists.

## Self-review notes (author)
- **Spec coverage:** frosted glass (all chrome) → T1/T2; button press-scale → T3; toast icons → T4; status bar (tool·coords·selection·zoom) → T5; empty-state card → T6.
- **No core changes:** everything is `@nodus-dev/react` (tokens/global-styles/toast/minimap) or the example app; cursor coords use the existing `editor.screenToWorld` from app-side pointer tracking — no new core API.
- **Fallback + a11y:** every frosted surface keeps a semi-opaque `glass` bg (readable without `backdrop-filter`); press-scale + any entrance are reduced-motion-gated; focus-visible rings already exist.
- **Verification reality:** no jsdom, so only `formatCoords` is unit-tested; the visual/DOM behavior is browser-verified (zero console errors gate + a screenshot for sign-off) — appropriate for a CSS subsystem.
