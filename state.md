## Current Goal
Make autopilot actually auto-start during Superpowers implementation/executing-task flow when approved artifacts are present.

## Decisions
- Approved Superpowers artifact execution now auto-starts autopilot from the live `session.status` busy path in `src/autopilot-hook.ts`.
- `shouldAutoStart` is no longer test-only in practice; runtime now uses the same trigger decision instead of leaving it disconnected.
- Auto-start activates session state directly instead of depending on the `/autopilot` command template executing inside the implementation flow.

## Plan Status
- Added a regression test in `src/autopilot-hook.test.ts` for live runtime auto-start on implementation/execution.
- Wired the runtime hook so approved artifact execution enables autopilot before idle continuation logic runs.
- Focused hook verification and full suite verification completed successfully.

## Evidence
- `src/autopilot-hook.test.ts` now proves approved artifact execution enables autopilot in the live runtime path.
- `src/autopilot-hook.ts` reads trigger metadata from `session.status` and auto-starts on `busy` when artifacts and readiness qualify.
- `npm run build && node --test "dist/autopilot-hook.test.js"` passed after the fix.
- `npm test` passed after the fix.

## Open Issues
- Repo changes are still uncommitted.
- Installed OpenCode runtime should be re-checked to confirm it emits the expected trigger metadata consistently.
