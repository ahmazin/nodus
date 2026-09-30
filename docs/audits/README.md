# Audits & internal records (archive)

This directory holds **archived internal engineering records** — point-in-time audits, remediation
ledgers, and the historical bug log. They are kept for provenance and are **not** current
user-facing documentation. For that, see the [docs site](https://ahmazin.github.io/nodus/docs) and
the per-package READMEs.

| File | What it is |
|---|---|
| `PRR-REMEDIATION-REPORT.md` | Product Readiness Review remediation report + launch runbook — what landed, what's deferred, and the human-only residual (tracks [PR #2](https://github.com/ahmazin/nodus/pull/2)). The source review is `PRR.md` at the repo root. |
| `PRE-PUBLICATION-AUDIT.md` | Pre-npm-publish audit (blockers + the icons-cloud "option 2" decision record). |
| `API-CONTRACTS-AUDIT.md` | API/contract-surface audit findings. |
| `CONTRACT-api-remediation.md` | Remediation ledger for the API-contract audit. |
| `BUGS.md` | Archived checkbox bug log. **Not** the intake channel — use [GitHub Issues](https://github.com/ahmazin/nodus/issues). |

Public bug/feature intake is **GitHub Issues**; questions go to **GitHub Discussions**. See
`CONTRIBUTING.md` and `SUPPORT.md` at the repo root.
