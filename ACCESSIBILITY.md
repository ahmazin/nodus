# Accessibility

Nodus's editor host is keyboard-operable (`role="application"`, Tab between nodes, Enter/F2 to edit,
Escape to release focus, `Shift+F10` for the context menu), announces selection through a visually
hidden `aria-live` region, honors `prefers-reduced-motion` end to end, ships measured-contrast themes,
and conveys status with a non-color channel (dashed stroke + corner glyph), not hue alone.

**Honest status:** canvas *content* is not yet fully exposed to screen readers beyond the current
selection, there is no formal WCAG conformance statement (VPAT/ACR) yet, and no localized strings ship
(English defaults only). These are tracked as known gaps.

**Full, canonical statement** — the complete keyboard model, screen-reader status, guarantees, and
roadmap — lives at **<https://ahmazin.github.io/nodus/docs/accessibility>**
(source: [`apps/site/src/pages/docs/accessibility.md`](apps/site/src/pages/docs/accessibility.md)).

Report accessibility issues on [GitHub](https://github.com/ahmazin/nodus) with your assistive
technology and browser.
