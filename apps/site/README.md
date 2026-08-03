# @nodus-dev/site

The Nodus marketing site — landing page today, with **`/docs`** and **`/playground`** reserved as
the slots it grows into. Built with **[Astro](https://astro.build)** and emits a plain **static**
bundle (no adapter, no server), so it deploys to any static host.

## Commands

```bash
pnpm --filter @nodus-dev/site dev            # Astro dev server (http://localhost:4321)
pnpm --filter @nodus-dev/site build          # FULL static build -> dist/ (landing + docs + /playground/)
pnpm --filter @nodus-dev/site build:landing  # landing + docs only (fast; skips the editor bundle)
pnpm --filter @nodus-dev/site preview        # serve the built dist/
```

`build` runs [`scripts/build.mjs`](./scripts/build.mjs): Astro emits the landing page + docs into
`dist/`, then the editor (`examples/browser`) is built with `--base=/playground/` into
`dist/playground/`. So the hero's "Try the demo" CTA resolves to a real, working editor on the same
origin. (In `dev`, `/playground/` is not served — run the editor separately with `pnpm dev` → :5188.)

## Structure

```
apps/site/
  astro.config.mjs        # static config; `site` = canonical origin (placeholder)
  src/
    config.ts             # SITE — single source of truth for every link + copy
    content/landing.html  # design body (framework-free markup), rendered via set:html
    pages/index.astro     # <head>, theme-variable CSS, vanilla interaction JS
  public/
    favicon.svg
    og-image.png          # 1200x630 social card (regen: see below)
```

### How the landing page is built

The page originates from a **Claude Design** artifact (`Nodus.dc.html`), imported via the DesignSync
MCP. The design's reactive preview runtime (React `x-dc` / `<sc-if>` / `{{ }}` bindings) was converted
to **framework-free** markup:

- `{{ rootStyle }}` + the light/dark var maps → CSS custom properties on `:root` /
  `:root[data-theme="light"]`, toggled by one attribute.
- `<sc-if>` icon/panel branches → both branches in the DOM, one shown via CSS.
- `onClick="{{ … }}"` handlers → `addEventListener` in `index.astro`'s module script
  (theme toggle, copy-to-clipboard, code tabs with arrow-key roving focus).

The design body is imported **raw** (`?raw`) and rendered with `set:html`, so the code-sample braces
(`{ presets: [...] }`) are never parsed as Astro expressions. Links are `%%TOKENS%%` resolved from
`config.ts` at build time.

## ⚠️ Placeholder URLs

Every external link (GitHub org `nodus-dev`, domain `nodus.dev`, Discord) is a **placeholder** — those
destinations do not exist yet. Edit **only** [`src/config.ts`](./src/config.ts) to make them real (and
`site` in `astro.config.mjs` to match `origin`). `docs` and `playground` are intentionally same-origin
paths.

## Pages

| Path                 | What                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| `/`                  | Landing page (`src/pages/index.astro`).                                              |
| `/docs`, `/docs/*`   | Docs — Markdown pages (`src/pages/docs/*.md`) via `DocsLayout`, with sidebar, on-page TOC, and prev/next. |
| `/playground/`       | The `@nodus-dev` editor (`examples/browser`) built into `dist/playground/`.              |
| `/404`               | Branded not-found page (`src/pages/404.astro`).                                      |
| `/sitemap.xml`       | Dependency-free endpoint (`src/pages/sitemap.xml.ts`); `public/robots.txt` points at it. |

Docs pages are **Markdown** (`.md`) so code samples with `{ braces }` render literally, with Shiki
syntax highlighting. The TOC is built from each page's `headings` (passed by Astro to the layout).
Add a page by dropping a new `.md` in `src/pages/docs/` (with the `DocsLayout` frontmatter) and adding
it to `DOCS_NAV` in `src/layouts/DocsLayout.astro` (which also drives prev/next order).

## Shared foundation

- `src/styles/theme.css` — resets + theme tokens (dark/light) + the toggle icon-swap. Imported by the
  landing page and by `SiteHead`.
- `src/components/SiteHead.astro` — `<head>` (meta/OG/fonts/favicon + anti-FOUC theme script).
- `src/scripts/theme.ts` — `initThemeToggle()`, used by every page's toggle.
- `src/layouts/DocsLayout.astro` — docs shell (header, sidebar, prose styling).

## Regenerating the OG image

`public/og-image.png` is a static 1200×630 card (dark bg + dot grid + lime glow + node mark),
produced with `@napi-rs/canvas`:

```bash
node apps/site/scripts/make-og.mjs   # rewrites public/og-image.png
```

It prefers the brand faces (Space Grotesk / JetBrains Mono) if installed and otherwise falls back to
the OS sans/mono — commit the regenerated PNG.

## Deploy

Point any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) at the build:

```bash
pnpm --filter @nodus-dev/site build   # output: apps/site/dist/
```
