# Governance

This document describes how decisions are made in Nodus (`@nodus-dev/*`) and how the project is
structured today. It is deliberately lightweight — Nodus is a young, pre-1.0 project — and will evolve
as the community grows.

## Current model: single maintainer (BDFL-lite)

Nodus is currently maintained by **one maintainer** (see [MAINTAINERS.md](./MAINTAINERS.md)). The
maintainer:

- reviews and merges pull requests,
- triages issues and Discussions,
- decides on scope, roadmap, and API direction,
- cuts releases and publishes to npm.

We are honest about what this means: **the project has a bus factor of one.** There is no committee,
no voting, and no second person who can currently publish releases or make binding decisions. If you
are evaluating Nodus as a dependency, weigh this accordingly.

## How decisions are made

- **Small changes** (bug fixes, docs, tests, non-breaking additions) are decided in the pull request /
  issue by the maintainer.
- **Larger or breaking changes** (new public API, changes to canonical serialization, removals) should
  start as a [GitHub Discussion](https://github.com/ahmazin/nodus/discussions) or an issue so the
  direction can be agreed before code is written. The stability implications are governed by
  [`docs/stability.md`](./docs/stability.md) and the `0.x` semver rules.
- **Disagreements** are resolved by the maintainer, who aims to explain the reasoning in the open. As
  the project gains additional maintainers, this will move toward lazy consensus among maintainers.

All substantive discussion happens in public (issues, PRs, Discussions) so the record is transparent.

## Becoming a maintainer

There is no formal committer track yet. The path is the usual one: sustained, high-quality
contributions and good judgment in reviews and discussions. If the project reaches the point of adding
maintainers, this section will be replaced with concrete criteria and a nomination process, and
[MAINTAINERS.md](./MAINTAINERS.md) will list the team.

## Succession and continuity (bus-factor mitigation)

Because the project currently depends on a single person, the maintainer intends to reduce that risk
before and during a wider public launch. The concrete steps — each of which is a **human action** the
maintainer must take, recorded here as intent, not as a completed guarantee — are:

1. **Add a second owner to the `@nodus-dev` npm organization** so releases are not gated on one
   account. Until this is done, publishing is single-keyed.
2. **Move the repository under a GitHub organization** matching the `@nodus-dev` scope, and grant a
   second person the owner/admin role, so the repo and its settings survive the loss of any one
   account.
3. **Document a credential-recovery / escrow arrangement** for the npm token and the domain (once one
   is owned), so a trusted party can recover publishing rights if the maintainer becomes unavailable.

Until items 1–3 are complete, treat Nodus as a single-maintainer project for continuity-planning
purposes. Progress on these items will be reflected in this document and in
[MAINTAINERS.md](./MAINTAINERS.md).

## Code of Conduct

Everyone participating in the project — maintainer included — is bound by the
[Code of Conduct](./CODE_OF_CONDUCT.md). Enforcement responsibility currently rests with the
maintainer.

## Changing this document

Changes to governance are made by the maintainer via pull request, with a reasonable window for
community comment on anything substantive.
