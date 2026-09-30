---
layout: ../../layouts/DocsLayout.astro
title: Support matrix
description: The platforms Nodus supports and tests — evergreen desktop browsers, Node 20+, React 18 — stated honestly against what CI actually exercises.
---

What Nodus supports, stated against **what CI actually exercises** — not aspirational claims. If a row
says "untested," it means exactly that: it may work, but nothing verifies it yet.

## Runtimes

| Target | Support | Notes |
|---|---|---|
| **Node.js** | 20+ | `engines` requires `>=20`; CI runs on **Node 22**. Node 20 is the supported floor; 22 is the tested version. |
| **Browsers (desktop)** | Evergreen Chrome, Firefox, Safari, Edge | The current and previous major of each. Browser behavior is verified with `playwright-core` against the live app. |
| **React** | 18 | Peer range is `react >=18`. **React 19 is not tested yet** — it may work via the open range, but nothing exercises it in CI. |

## Module formats

- **ESM and CJS** — every package ships dual builds with a correct `exports` map; tree-shaking-friendly.
- **`@nodus-dev/react` is SSR-safe** — it carries a `'use client'` banner and provides a server
  snapshot, so importing it never crashes a server render (Next.js App or Pages Router, Remix). The
  canvas itself paints only after hydration. See [React binding → SSR](/docs/react#server-side-rendering).
- **Headless** — `@nodus-dev/core` has zero DOM dependencies and renders in Node via Skia
  (`@napi-rs/canvas`). See [Headless rendering](/docs/headless).

## Input

| Input | Support |
|---|---|
| Mouse / trackpad | Full |
| Keyboard | Navigation + core authoring verbs — see [Accessibility](/docs/accessibility) |
| **Touch** | **Basic** two-finger pan and pinch-zoom (added in 0.3). Deeper multi-touch gestures are still maturing. |
| Pen / stylus | Treated as a pointer; the freehand plugin uses pressure where available. |

## Devices

Nodus targets **desktop-class** use today. The editor works on tablets with the basic touch support
above, but small-screen phone layouts are not a priority yet — the composed playground is best on a
desktop viewport.

## Accessibility & i18n

- **Keyboard model and screen-reader status:** see the [accessibility statement](/docs/accessibility)
  for the honest, current picture (no formal WCAG conformance statement yet).
- **i18n:** a message-override API exists with English defaults; **no translated locales ship yet**.

## What "supported" means before 1.0

Everything is on the synchronized [`0.3.x` line](/docs/versioning). Fixes land on the latest minor;
there is no back-port channel before 1.0. Upgrade the whole `@nodus-dev/*` set together.

## See also

- [Accessibility](/docs/accessibility) · [Privacy & telemetry](/docs/privacy) · [Performance](/docs/performance)
- [Troubleshooting & FAQ](/docs/troubleshooting)
