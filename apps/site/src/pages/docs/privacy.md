---
layout: ../../layouts/DocsLayout.astro
title: Privacy & telemetry
description: Nodus collects nothing. No analytics or error-reporting in any package or the playground; documents live only in your browser's localStorage; web fonts are opt-in.
---

**Nodus collects zero telemetry.** There is no analytics, no error-reporting, no phone-home, and no
tracking in any `@nodus-dev/*` package or in the hosted playground. This page states that plainly so
you can verify it and depend on it.

## What we don't collect

- **No analytics.** No usage events, no page-view beacons, no session recording in the packages or the
  playground.
- **No error reporting.** No Sentry, no crash upload. Errors surface on the editor's `error` event
  channel for *your* app to handle — they are never sent anywhere by Nodus.
- **No account, no server calls.** The engine is headless and local-first. `@nodus-dev/core` makes no
  network requests. Persistence is a `DocStore` interface you back with your own storage — Nodus ships
  no hosted backend.

## Where your documents live

- **The playground stores documents in your browser's `localStorage`.** Nothing you draw leaves the
  browser — there is no upload, no shared server, no sync. Clearing site data clears your documents.
- **The CLI and headless renderer** read and write files **on your machine** only.
- **The [MCP server](/docs/mcp)** writes only inside its data dir by default (`.nodus-mcp/` or
  `NODUS_MCP_DATA`); it does not transmit anything.

## Web fonts are opt-in

Mounting a Nodus component makes **no third-party network request** by default: text falls back to the
system UI font via the `--nodus-font` CSS variable. Web fonts are explicitly opt-in:

```ts
import { injectGlobalStyles } from '@nodus-dev/react';
injectGlobalStyles({ webFonts: true }); // only then are fonts fetched
```

Leave it off (the default) and you get no external font request — no CSP or GDPR surprise, and it
works offline. You can also self-host by pointing `--nodus-font` at your own family. See
[React binding → Fonts](/docs/react#fonts--injected-styles).

## Third-party asset terms

`@nodus-dev/icons-cloud` bundles curated cloud-provider glyphs (AWS/Azure/GCP) for diagram use; the
provider trademark terms pass through to you as the consumer. That is an asset-licensing note, not data
collection — no icon usage is tracked.

## The marketing/docs site

The site (`apps/site`) is a static bundle. Any future site-side analytics, if ever added, would be
privacy-friendly and disclosed here.

## Future telemetry would be opt-in

If Nodus ever adds any telemetry, it will be **opt-in only** and documented on this page before it
ships. The default will always be: collect nothing.

## See also

- [Support matrix](/docs/support-matrix) · [Accessibility](/docs/accessibility)
- [React binding](/docs/react) — the font-injection and error-channel details.
