# Project Map
_Generated: 2026-04-26 00:00 | Git: uncommitted_

## Directory Structure
src/ — OpenCode plugin source for autopilot hooks, commands, state, and prompt builders.
docs/ — Superpowers specs/plans plus supporting project documents.

## Key Files
src/index.ts — plugin entry that registers the autopilot tool, command hook, and event handling.
src/autopilot-hook.ts — core autopilot state machine, idle assessment, continuation scheduling, and stop logic.
src/utils.ts — parses `/autopilot` commands and builds internal startup/continuation prompts.
src/types.ts — shared config/state/idle assessment types that shape plugin behavior.
src/autopilot-hook.test.ts — large regression suite covering looping, stop conditions, and session behavior.
README.md — user-facing install, command, and behavior documentation; also notes planned review mode.
AUTOPILOT_SUPERPOWERS.md — single source of truth for product intent, gap analysis, target architecture, and repair roadmap.
docs/oh-my-opencode-slim-auto-continue-notes.md — local reference notes for the upstream `/auto-continue` command pattern and its implications here.

## Critical Constraints
- Plugin state is in-memory per OpenCode session; autopilot state is not durable across process restarts.
- Startup prompts already rely on markers like `[AUTOPILOT MODE ENABLED]` and `[AUTOPILOT-INTERNAL]`; new orchestration must preserve anti-reentry guards.
- Current code references superpowers workflow textually, but does not enforce external superpowers installation or oh-my-opencode-slim agent usage yet.
- OpenCode config schema previously rejected custom autopilot config in global config, so defaults may need to stay code-driven or be integrated carefully.
- `oh-my-opencode-slim` implements `/auto-continue` via `config.command` + tool exposure + `command.execute.before`; if that pattern still fails locally, suspect host runtime semantics rather than plugin structure.

## Hot Files
src/autopilot-hook.ts, src/index.ts, src/utils.ts, README.md, src/autopilot-hook.test.ts
