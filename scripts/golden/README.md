# Golden-image regression harness

Pixel-diff regression tests for the Canvas-2D renderer. Each fixture is a
**fixed-coordinate** diagram (hardcoded node `x/y/w/h` + a fixed camera, **no
auto-layout engine**) so the headless Skia render is byte-stable across runs and
the baseline PNGs are safe to commit and diff in CI.

Why fixed coordinates: the dagre/tree/force/elk layout engines are
non-deterministic in this sandbox (see the repo `CLAUDE.md` "local render
gotcha"), which would make layout-driven baselines flap. Fixing every
coordinate removes that variable — the only thing under test is the renderer.

## Files

- `fixtures.ts` — the fixture definitions (`FIXTURES`). Add a fixture by
  appending an entry; keep `w`/`h` hardcoded and set an explicit `camera`.
- `render.ts` — the single deterministic render path (`renderFixture`) shared by
  both scripts, so generate and compare can never drift. Pins DPR=2 and a
  system monospace font.
- `generate.ts` — writes `baseline/<name>.png`.
- `compare.ts` — renders live, pixel-diffs against `baseline/`, exits non-zero on
  mismatch and writes diff artifacts to `diff/`.
- `baseline/*.png` — committed reference renders (the source of truth).
- `diff/` — created only on a failing `compare` run; **git-ignored / never
  committed** (`*.diff.png` = highlighted diff, `*.actual.png` = the live render).

## Usage

### check (CI + local regression gate)

```bash
pnpm tsx scripts/golden/compare.ts
```

Exit 0 when every fixture is within threshold; exit 1 on any pixel mismatch, a
missing baseline, or a dimension change. On failure it writes
`scripts/golden/diff/<name>.diff.png` and `<name>.actual.png` for inspection.

### regenerate (only when a render change is intentional)

```bash
pnpm tsx scripts/golden/generate.ts
```

Overwrites every `baseline/*.png`. Run this **only** when you have deliberately
changed rendering output, then review the PNG diff and commit the new baselines
like any other reviewed change. CI never regenerates — a genuine visual change
must be an explicit, reviewed commit.

## Thresholds

Defined at the top of `compare.ts`:

- `PIXELMATCH_THRESHOLD = 0.1` — per-pixel color tolerance (0..1).
- `MAX_DIFF_RATIO = 0.001` — at most 0.1% of pixels may differ per image.

Both are intentionally small: fixed-coordinate fixtures should render
byte-identically on the same toolchain (the harness measures 0/N differing
pixels locally). The small ratio only absorbs sub-pixel antialiasing jitter
across `@napi-rs/canvas` builds. If baselines were generated on a different
toolchain than CI (e.g. a different Skia build), regenerate them on the CI runner
so the reference matches the environment that checks it.

## CI

The golden job runs `compare.ts` and is **non-blocking initially** (it reports
mismatches without failing the pipeline) until baseline stability across the CI
runner's canvas build is confirmed; promote it to blocking afterwards.
