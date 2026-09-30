<!--
Thanks for contributing to Nodus! Please read CONTRIBUTING.md if you haven't.
Keep PRs small and focused — they are much easier to review.
-->

## Summary

<!-- What does this PR change, and why? -->

## Related issue

<!-- e.g. "Closes #123". If there is no issue, briefly explain the motivation above. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (a `minor` bump under the 0.x policy)
- [ ] Docs / tests / tooling only (no published-behavior change)

## Checklist

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, and I added a test that fails without this change (or explained why one is not applicable).
- [ ] `pnpm verify:render` passes (if I touched rendering / interaction / serialization).
- [ ] **Added a changeset** (`pnpm changeset`) if this changes the public behavior of a published package. <!-- required for user-facing changes; see CONTRIBUTING.md -->
- [ ] Model mutations go through `store.apply` / editor helpers (I did not mutate records in place).
- [ ] Docs / READMEs updated if I changed a public interface.
- [ ] For canonical `*.nodus.json` output changes: regenerated golden fixtures and included a `minor` changeset.

## Notes for reviewers

<!-- Anything reviewers should focus on, known limitations, follow-ups, or screenshots for UI changes. -->
