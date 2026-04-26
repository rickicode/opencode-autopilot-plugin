## Current Goal
Prove end-to-end `/autopilot` execution in installed OpenCode runtime after fixing local install/readiness gaps.

## Decisions
- Approved Superpowers artifact execution auto-starts autopilot from the live `session.status` busy path in `src/autopilot-hook.ts`.
- Install readiness now requires the active config path to contain `commands/autopilot.md`, not just merged JSON command metadata.
- Missing command markdown is tracked as a dedicated readiness blocker so install false-positives fail before smoke testing.

## Plan Status
- Added runtime auto-start regression coverage in `src/autopilot-hook.test.ts` and verified the hook fix earlier in this task.
- Added bootstrap regression coverage proving readiness flips false when `commands/autopilot.md` is removed after an otherwise valid install.
- Updated bootstrap/readiness/runtime stubs to support the command-file-installed gate; full `npm test` passes.
- Reinstalled into `~/.config/opencode/opencode.json`; `npm run readiness:check` now reports `ready=true` with no missing items.

## Evidence
- `src/bootstrap.test.ts` now proves a valid install becomes not ready when `commands/autopilot.md` is removed.
- `src/bootstrap.ts`, `src/readiness.ts`, `src/readiness.test.ts`, `src/types.ts`, and `src/autopilot-hook.ts` enforce the command-file-installed readiness gate.
- `npm test` passed after the readiness/install fix.
- `OPENCODE_CONFIG_PATH="$HOME/.config/opencode/opencode.json" npm run readiness:check` returned `ready=true` and `missing=`.
- `OPENCODE_CONFIG_PATH="$HOME/.config/opencode/opencode.json" opencode run --command autopilot --agent superpowers -- "status"` still failed because the host runtime reported the `autopilot` tool was unavailable.

## Open Issues
- Repo changes are still uncommitted.
- Remaining blocker is host runtime tool injection for `opencode run --command autopilot`, not local install readiness.
