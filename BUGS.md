# Bugs

Tracking list of known issues. Check off when fixed.

## Tracking

- [x] **Copy PNG doesn't work** — clipboard write now feature-detected + gesture-safe (Safari/older-Firefox no longer drop the user activation), falls back to a PNG download when the clipboard is unavailable/blocked, and shows a toast either way instead of failing silently.
- [x] **Copy as Image from the command palette doesn't work** — same fix; the palette command now routes through `copyOrDownloadImage`.
- [x] **Can't change connection style** — not reproducible; verified working in Firefox + Chromium. Right-click an edge → `Router → straight/orthogonal/bezier` (line shape), `Style → red/amber/dashed` (color/dash), and `Clear style` all apply and repaint. Note: `straight` vs `orthogonal` look identical on a horizontal/short edge, which can read as "nothing changed."
