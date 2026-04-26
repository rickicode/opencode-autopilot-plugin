# opencode-autopilot-superpowers

Autopilot mode for OpenCode from the `opencode-autopilot-superpowers` package. It turns a normal task request into a bounded autonomous workflow that follows the Superpowers process, shows loop status, prefers delegated execution, and stops at safety checkpoints.

This repository is the **maintained TypeScript source** for the `opencode-autopilot-superpowers` package, the `/autopilot` plugin flow, the bootstrap installer, and the test suite.

## Quick Start

### Current supported install flow

```bash
npm install
npm run bootstrap:dry-run
npm run bootstrap:install
```

Then verify the current installed state:

```bash
npm run readiness:check
```

Run the full repo verification suite:

```bash
npm test
```

## Prerequisites

You should have:

- Node.js and npm
- an OpenCode installation
- a writable OpenCode config file, typically `~/.config/opencode/opencode.json`
- a POSIX shell (`sh`, `bash`, or `zsh`) for the command examples shown in this README

## Repository Role

- Maintained source package: this repository
- Local bootstrap entrypoint: `scripts/install-autopilot.mjs`
- Build output consumed by the installer: `dist/bootstrap.js`

If you also keep a separately copied plugin file under an OpenCode config directory, treat that as a **deployment artifact** or downstream integration target, not the primary source of truth.

## What Autopilot Does

Autopilot injects an internal prompt that tells the active agent to:

- Enter autonomous execution mode
- Follow the Superpowers workflow
- Classify task complexity first
- Proceed directly only for MICRO/LIGHTWEIGHT or clearly non-architectural tasks
- Use required design/planning workflow for FULL/new behavior tasks
- Prefer subagent-driven execution for implementation
- Show visible loop status at each autonomous step
- Stop for ambiguity, critical failures, high-risk decisions, and merge/PR decisions

The visible status format is:

```text
[AUTOPILOT STATUS] Loop: X/N | Phase: <phase> | Next: <next action>
```

### Auto-engage on Superpowers idle

By default the plugin auto-engages autopilot the first time a Superpowers
session goes idle, so the user does not have to type `/autopilot` after
Superpowers finishes a task. The hook tracks the active agent through the
`chat.message` lifecycle event, and on the next idle (or `session.status`
idle) it:

1. Enables autopilot for that session with the default 7-loop budget.
2. Posts an inline `AUTOPILOT ACTIVE` banner via a `noReply` prompt so the
   user can see autopilot has taken over.
3. Schedules a normal continuation cycle (with the inline countdown
   notification) on every subsequent idle until the loop budget is
   exhausted, the user types `/autopilot off`, or a stop gate fires.

To disable auto-engage, set `autoEnable: false` in the plugin's autopilot
config. The user can still invoke `/autopilot` manually at any time.

### Inline status while running

While autopilot is running with a positive `cooldownMs` (default 3000ms),
each scheduled continuation is preceded by an inline `noReply` notification
of the form:

```text
⎔ Autopilot active: loop X/N — resuming in 3s — Esc×2 to cancel
```

This is the user-visible signal that autopilot is in control of the
session. Pressing `Esc×2` during the cooldown cancels the upcoming
continuation. Setting `cooldownMs: 0` (used in tests) suppresses the
inline notification and injects continuations immediately.

## Commands

### Start Autopilot

```bash
/autopilot add user authentication with JWT
```

Starts autopilot with the default loop budget (7) and shows an inline active banner.

Quotes around the task are optional — both forms are accepted:

```bash
/autopilot "add user authentication with JWT"
/autopilot add user authentication with JWT
```

A bare `/autopilot` with no arguments enables autopilot in standby — the next idle event triggers the standard continuation prompt up to the configured loop budget. This mirrors the toggle behavior of `/auto-continue` in `oh-my-opencode-slim`.

The activation output includes a visible `AUTOPILOT ACTIVE` banner before the normal startup guidance.

### Set Loop Budget

```bash
/autopilot --loops 15 refactor database layer
/autopilot --loops 15 "refactor database layer"
/autopilot --loops 15
```

`--loops` must appear before the task (if any) and must be a positive integer. Without a task, the loop budget is applied to the next standby/auto-engage cycle.

### Status

```bash
/autopilot status
```

Shows whether autopilot is active for the current plugin instance, the active task, and the loop budget.

### Stop

```bash
/autopilot off
```

Disables autopilot for the current plugin instance. It preserves the last task and loop budget so `resume` can restore context.

### Resume

```bash
/autopilot resume
```

Resumes the most recent task if context is still available and shows the same inline active banner.

Optional loop override:

```bash
/autopilot resume --loops 8
```

This replaces the stored loop budget for the resumed run.

## Parsing Rules

Control words are only treated as controls when they are the entire argument:

- `/autopilot off` stops autopilot
- `/autopilot resume` resumes autopilot
- `/autopilot status` shows status

Quoted control words are treated as task text:

```bash
/autopilot "off"
/autopilot "resume"
/autopilot "status"
/autopilot --loops 5 "off"
```

The task argument can be quoted or unquoted; surrounding double or single quotes are stripped automatically. `--loops N` must appear before the task and `N` must be a positive integer — values like `--loops 0` or `--loops abc` are rejected.

## Safety Behavior

Autopilot stops and asks the user when:

- Requirements are ambiguous
- Multiple valid approaches have meaningful trade-offs
- A high-risk architecture decision appears
- Verification fails or a critical error occurs
- A subagent reports blocked state
- Merge, PR, or branch outcome decision is needed

Runtime note: when the host emits `session.status` with `status.type === 'error'`, autopilot stops immediately if `stopOnError` is enabled. If `stopOnError` is disabled, the session remains resumable and can continue on the next idle cycle.

Autopilot must not merge, create PRs, or make irreversible branch decisions without user confirmation.

## Superpowers Integration

The `superpowers` agent can automatically activate autopilot when the current work references approved Superpowers spec and plan artifacts, except when the current message is already an `/autopilot` command or already contains the injected autopilot marker.

Artifact-based execution can auto-start when the current work references approved Superpowers spec and plan artifacts under `docs/superpowers/specs` and `docs/superpowers/plans`, using `-approved.md` filenames as the approval marker.

That artifact-triggered path does not auto-start when approval is still pending or when the current action is design-doc/spec editing or review.

Important double-activation guard:

```text
Do not call the autopilot tool again for this command; this message already activated autopilot mode.
```

The agent prompt also says not to call the `autopilot` tool if `/autopilot` command output already injected:

```text
[AUTOPILOT MODE ENABLED - AUTONOMOUS EXECUTION]
```

## OpenCode Permissions

The global OpenCode config currently allows external directory edits:

```jsonc
{
  "permission": {
    "external_directory": "allow"
  }
}
```

This is required for autopilot tasks that write to `/tmp/*` during tests or smoke checks.

`doom_loop` is intentionally not set to `allow`. OpenCode uses it as a safety permission when the same tool call repeats 3 times with identical input. The recommended default is `ask`.

## Configuration

The plugin currently supports default loop config from these runtime context shapes:

```js
ctx.plugin.autopilot.defaultMaxLoops
ctx.config.autopilot.defaultMaxLoops
```

However, top-level `autopilot` config in `~/.config/opencode/opencode.json` was previously rejected by OpenCode schema, so do not add this to global config unless OpenCode adds schema support for plugin-specific config.

Current safe default is `7`, clamped to `1..30`.

By default, autopilot auto-continues on each eligible idle cycle for up to 7 loops unless the current command or runtime config overrides the loop budget. The default phase-loop, repeated-idle, and consecutive-continuation safety gates are aligned to allow those 7 consecutive idle continuations before stopping.

## Installation

Use the bootstrap installer flow instead of editing OpenCode config by hand.

### Installer workflow

Current supported flow is via the npm wrapper scripts from this repository. They build first, then run the installer against the built `dist/bootstrap.js` entrypoint:

> Shell note: command examples in this section assume a POSIX shell (`sh`/`bash`/`zsh`).

```bash
npm run bootstrap:install
```

If your OpenCode config lives somewhere else, point the wrapper script at it:

```bash
OPENCODE_CONFIG_PATH="/path/to/opencode.json" npm run bootstrap:install
```

Dry-run the same local installer without mutating config:

```bash
npm run bootstrap:dry-run
```

Check the **current installed state** without applying changes:

```bash
npm run readiness:check
```

That command reads your config as it exists on disk and exits non-zero if the installation is not actually ready.

### Current support vs future curl installer

Hosted curl piping is **not** the current supported path for this repo as-is, because `scripts/install-autopilot.mjs` imports `../dist/bootstrap.js` and is not a stdin-standalone artifact.

The examples below are **illustrative future UX only**. They are not the supported install path today.

```bash
curl -fsSL <install-autopilot-url> | node
```

And with an explicit config path:

```bash
curl -fsSL <install-autopilot-url> | OPENCODE_CONFIG_PATH="/path/to/opencode.json" node
```

The bootstrap wizard performs this user-facing sequence:

1. `detect-opencode`
2. `backup-config`
3. `ensure-superpowers`
4. `install-autopilot`
5. `provision-agents`
6. `validate-readiness`

### What readiness means

A successful bootstrap leaves your OpenCode config in a state where:

- the plugin declaration includes `superpowers@git+https://github.com/obra/superpowers.git`
- the plugin declaration includes the local autopilot plugin path for this repository
- the Superpowers plugin entry is declared
- the managed autopilot agents are provisioned as `superpowers`, `superpowers-explorer`, `superpowers-implementer`, `superpowers-knowledge`, `superpowers-designer`, and `superpowers-reviewer`
- `superpowers` is available as the managed default agent when no conflicting default is already pinned
- `npm run readiness:check` reports the **current installed state** as ready

### Supported assumptions

This bootstrap path assumes:

- OpenCode configuration is stored in a writable local JSON file
- the installer can back up and rewrite that file safely
- local agent provisioning is acceptable for slim-style specialist setup

This task does **not** provide full runtime autopilot behavior parity with upstream slim automation hooks, and it does **not** support remote-managed or immutable OpenCode config stores.

### Local verification

`npm run bootstrap:dry-run` sets `AUTOPILOT_DRY_RUN=1`, so it simulates the merge, reports readiness from the simulated merged config, and does not rewrite the file.

If you want a standalone readiness report for the current installed state without applying changes, use:

```bash
npm run readiness:check
```

Verify the full integrated test suite in this repo first:

```bash
npm test
```

## Development Verification

Primary verification for this repository:

```bash
npm test
```

Secondary downstream/integration verification, if you are also validating an external consuming workspace such as `/workspaces/9router-plus` *(environment-specific example path)*:

```bash
node --test "tests/autopilot-plugin.test.mjs"
```

Expected result: all tests pass and the suite reports `0 fail`.

Optional downstream syntax check for separately deployed plugin copies using environment-specific example paths:

```bash
node --check "/workspaces/9router-plus/.opencode/plugins/autopilot.js" && \
node --check "/home/ricki/.config/opencode/plugins/autopilot.js"
```

Expected result: no output and exit code `0`.

Known warning:

```text
MODULE_TYPELESS_PACKAGE_JSON
```

This warning appears because the `.js` plugin files use ESM syntax without a nearby `package.json` declaring `"type": "module"`. It is a metadata/performance warning, not a test failure.

## Runtime Smoke Checks

Normal command:

```bash
opencode run "/autopilot --loops 2 create /tmp/autopilot-final-proof-2.js with module.exports = 789" --agent superpowers
```

Expected behavior:

- Autopilot activates
- Loop status appears
- File is created in `/tmp`
- Verification confirms exact content

Status:

```bash
opencode run "/autopilot status" --agent superpowers
```

Malformed command:

```bash
opencode run '/autopilot "off' --agent superpowers
```

Unit tests verify the plugin parser rejects this as usage. Note: OpenCode CLI slash-command parsing may normalize malformed shell-quoted command text before plugin hook receives it, so parser-level behavior is the reliable source for this edge case.

## Planned Feature: Bug-Risk Analysis Mode

Proposed command:

```bash
/autopilot review "scope or task"
```

Examples:

```bash
/autopilot review "analyze autopilot plugin for potential bugs"
/autopilot review "check latest changes before merge"
```

Recommended behavior:

- Read-only mode
- No file edits
- No auto-fix
- Focus on potential bugs and risks
- Report findings before taking action

Review should look for:

- Logic bugs
- Parser bugs
- State bugs
- Edge cases
- Security risks
- Race/concurrency risks
- Prompt-policy conflicts
- Missing tests
- Config compatibility issues
- Runtime behavior mismatches

Recommended output format:

```text
Critical
High
Medium
Minor
Residual risks
Recommended fixes
```

Recommended separation of concerns:

- `/autopilot review "..."` analyzes only
- `/autopilot "fix findings..."` fixes only after user asks

Failure modes to prevent when implementing review mode:

- Review mode accidentally edits files
- Review output lacks file/line references
- False positives are reported as confirmed bugs
- Review triggers normal autopilot execution

Planned safeguards:

- Explicit read-only prompt
- Findings-first output
- Distinguish confirmed bug vs risk
- Require path/line references where available
- Do not call implementation subagents from review mode unless user explicitly asks for fixes

## Known Limitations

- Autopilot is prompt-guided; model compliance can vary in unusual conversations.
- `/autopilot resume` can only resume if enough context remains in the current session.
- Plugin state is per plugin instance, not durable across all OpenCode sessions.
- Global/repo plugin parity depends on keeping both files synchronized.
- Planned `/autopilot review` mode is not implemented yet.

## Troubleshooting

### `npm run readiness:check` exits non-zero

That means the current installed state is not ready yet. Common causes:

- Superpowers plugin is not declared in OpenCode config
- managed autopilot agents are not present yet
- OpenCode config path is wrong
- OpenCode config file is unreadable or invalid JSON

Recommended flow:

```bash
npm run bootstrap:dry-run
npm run bootstrap:install
npm run readiness:check
```

### Bootstrap commands work in bash but not in another shell

The documented install examples currently assume a POSIX shell. If you use a different shell environment, set `OPENCODE_CONFIG_PATH` in the equivalent syntax for that shell before running the npm scripts.

## License

MIT
