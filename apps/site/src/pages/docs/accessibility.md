---
layout: ../../layouts/DocsLayout.astro
title: Accessibility
description: Nodus's accessibility model — the keyboard operation model, an honest screen-reader status, reduced-motion and contrast guarantees, and the conformance roadmap.
---

This is the canonical accessibility statement for Nodus. It describes what works today, states the
**known gaps honestly**, and lays out the roadmap. It is deliberately not a conformance claim — there
is no formal WCAG conformance statement (VPAT/ACR) yet.

The root [`ACCESSIBILITY.md`](https://github.com/ahmazin/nodus/blob/mainline/ACCESSIBILITY.md) in the
repo is a short pointer to this page.

## What works today

- **The canvas host is focusable and operable by keyboard.** `<Nodus>` renders a
  `role="application"` host with an instructive `aria-label` and `tabIndex={0}`. Tab moves between
  nodes in reading order (with auto-pan to keep the target in view); arrow keys nudge the selection.
- **Selection is announced.** A visually-hidden `aria-live="polite"` region announces the current
  selection (`"<label> — i of n"`, or a count for multi-select) so screen-reader users are told what
  changed as they Tab through the diagram.
- **Core authoring verbs have a keyboard path.** Enter/F2 edits the selected node's label; a
  connect-from-selection command lets you create edges without a mouse; the create tool places a node
  at the viewport center on Enter.
- **Focus is never trapped.** Escape releases focus from the canvas so keyboard users can Tab onward
  (the exit is documented in the host's `aria-label`).
- **Dialogs and menus follow their ARIA patterns.** The ⌘K command palette is a compliant combobox;
  the context menu (openable from the keyboard) and the review modal are focus-trapped with arrow-key
  navigation and Escape to close.
- **Reduced motion is honored end-to-end.** `prefers-reduced-motion` disables the selection halo
  animation, marching-ants, and flow packet motion — the reduced-motion state renders static.
- **Status is not conveyed by color alone.** Overlay states (met / partial / missed) add a non-color
  channel — a dashed stroke plus a corner glyph badge — so the state reads without relying on hue
  (WCAG 1.4.1).
- **Contrast is measured.** The chrome design tokens carry measured WCAG contrast ratios in both light
  and dark themes.

## Keyboard model

| Action | Keys |
|---|---|
| Move focus between nodes | `Tab` / `Shift+Tab` |
| Release focus from the canvas | `Escape` (with nothing selected) |
| Nudge selection | Arrow keys |
| Edit selected node's label | `Enter` or `F2` |
| Place a node (create tool) | `Enter` (at viewport center) |
| Connect from selection | connect-from-selection command, then `Tab` to a target + `Enter` |
| Open the context menu | `Shift+F10` / `ContextMenu` |
| Command palette | `⌘K` / `Ctrl+K` |
| Undo / redo | `⌘Z` / `⌘⇧Z` (or `Ctrl`) |
| Delete selection | `Delete` / `Backspace` |
| Pan | Space-drag |

## Known gaps (honest status)

- **Canvas content is not fully exposed to screen readers.** Selection is announced, but there is no
  complete accessible structural mirror of the whole diagram (every node/edge and its relationships).
  A blind user can navigate and act on the selection, but cannot yet read the full graph structure via
  a screen reader.
- **No formal conformance statement.** There is no VPAT/ACR and no automated conformance audit gating
  releases yet (an axe-core keyboard smoke is being added to the verification suite).
- **Panel keyboard patterns are still filling in.** Some panels (layers tree, toolbar) declare ARIA
  roles whose full roving-tabindex keyboard navigation is in progress.
- **No shipped translations.** A message-override API exists with English defaults, but no localized
  strings ship yet, and RTL is not yet addressed. See [support matrix](/docs/support-matrix).

## Roadmap

- An accessible structural mirror of canvas content for screen readers (beyond selection
  announcements).
- Automated accessibility checks (axe-core + keyboard smoke) in CI.
- Complete roving-tabindex keyboard navigation across all published panels.
- A formal conformance statement (VPAT/ACR) once the above land.

Track these under *Later* on the
[roadmap](https://github.com/ahmazin/nodus/blob/mainline/docs/ROADMAP.md).

## Reporting an issue

Accessibility bugs are treated as real bugs. Please
[open an issue on GitHub](https://github.com/ahmazin/nodus) with the assistive technology and browser
you're using.

## See also

- [Support matrix](/docs/support-matrix) · [Privacy & telemetry](/docs/privacy)
- [React binding](/docs/react) — focus scoping and injected `:focus-visible` / reduced-motion styles.
