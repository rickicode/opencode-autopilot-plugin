# Project Map
_Generated: 2026-04-26 00:00 | Git: uncommitted_

## Directory Structure
src/ — OpenCode plugin source for autopilot hooks, commands, state, and prompt builders.
docs/ — superpowers-optimized specs and plans for autopilot behavior.

## Key Files
src/index.ts — plugin entry that registers the autopilot tool, command hook, and event handling.
src/autopilot-hook.ts — core autopilot state machine, idle assessment, continuation scheduling, and stop logic.
src/utils.ts — parses `/autopilot` commands and builds internal startup/continuation prompts.
src/types.ts — shared config/state/idle assessment types that shape plugin behavior.
src/autopilot-hook.test.ts — large regression suite covering looping, stop conditions, and session behavior.
README.md — user-facing install, command, and behavior documentation; also notes planned review mode.
docs/superpowers-optimized/specs/idle-loop-assessment.md — behavior spec for idle-loop decision logic.
docs/superpowers-optimized/plans/idle-loop-assessment-plan.md — implementation plan history for the idle-loop feature.

## Critical Constraints
- Plugin state is in-memory per OpenCode session; autopilot state is not durable across process restarts.
- Startup prompts already rely on markers like `[AUTOPILOT MODE ENABLED]` and `[AUTOPILOT-INTERNAL]`; new orchestration must preserve anti-reentry guards.
- Current code references superpowers workflow textually, but does not enforce external superpowers installation or oh-my-opencode-slim agent usage yet.
- OpenCode config schema previously rejected custom autopilot config in global config, so defaults may need to stay code-driven or be integrated carefully.

## Hot Files
src/autopilot-hook.ts, src/index.ts, src/utils.ts, README.md, src/autopilot-hook.test.ts
