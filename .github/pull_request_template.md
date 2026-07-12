<!-- docs-impact: {"version":1,"exemptions":[]} -->

## Summary

<!-- Describe the user or engineering outcome. -->

## Documentation impact

- Categories: <!-- status / user / developer / API / config / storage / permissions / release / none -->
- Updated paths:
- Product status changed: <!-- yes / no -->
- Active spec or plan closeout required: <!-- yes / no -->

If a high-signal rule has no documentation impact, add one exemption object to the JSON comment at the top. Use the triggered rule ID and a specific reason of at least 20 characters. A maintainer with write access must review the reason and apply the `docs-impact-approved` label for the current PR head. Remove and reapply the label after every push or PR-body edit. Static contracts such as the API route inventory cannot be exempted.

## Verification

- [ ] `pnpm verify`
- [ ] Relevant focused tests
- [ ] Electron visual comparison, or not applicable
- [ ] Every intentional screenshot difference was reviewed and recorded

Evidence:

<!-- Commands, results, screenshots, or manual checks. -->
