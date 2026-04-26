# OpenCode Autopilot Plugin

Autopilot mode for OpenCode. It turns a normal task request into a bounded autonomous workflow that follows the Superpowers agent process, shows loop status, and stops at safety checkpoints.

This repository contains the maintained TypeScript source, bootstrap installer, and tests for the OpenCode autopilot package and local installation flow.

## Current Status

- Maintained source package: `/workspaces/autopilot-plugin` *(environment-specific example from the author's workspace)*
- Local bootstrap entrypoint: `scripts/install-autopilot.mjs`
- Build output consumed by the installer: `dist/bootstrap.js`
- Active environment-specific plugin copies may still exist elsewhere during integration testing

This repo is the maintained implementation source for the autopilot bootstrap/package flow. If you also keep a separately copied plugin file under an OpenCode config directory, treat that as a deployment artifact or downstream integration target, not the primary source of truth.

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

## Commands

### Start Autopilot

```bash
/autopilot "add user authentication with JWT"
```

Starts autopilot with the default loop budget.

### Set Loop Budget

Prefix form:

```bash
/autopilot --loops 15 "refactor database layer"
```

Suffix form:

```bash
/autopilot "refactor database layer" --loops 15
```

Loop budget is clamped to `1..30`.

Examples:

- `--loops 0` becomes `1`
- `--loops 999` becomes `30`
- Float values are truncated in tool mode, e.g. `2.9` becomes `2`

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

Resumes the most recent task if context is still available.

Optional loop override:

```bash
/autopilot resume --loops 8
```

## Parsing Rules

Control words are only treated as controls when unquoted:

- `/autopilot off` stops autopilot
- `/autopilot resume` resumes autopilot
- `/autopilot status` shows status

Quoted control words are treated as task text:

```bash
/autopilot "off"
/autopilot "resume"
/autopilot "status"
/autopilot --loops 5 "off"
/autopilot "resume" --loops 7
```

Malformed quotes are rejected as usage errors instead of triggering control actions:

```bash
/autopilot "off
/autopilot off"
/autopilot "resume'
/autopilot status" --loops 5
```

Malformed loop flags are also rejected:

```bash
/autopilot --loops 5
/autopilot --loops abc create x
/autopilot create x --loops nope
```

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

The Superpowers agent automatically activates autopilot for FULL tasks, except when the current message is already an `/autopilot` command or already contains the injected autopilot marker.

Artifact-based execution can also auto-start when the current work references supported Superpowers spec/plan artifacts under `docs/superpowers-optimized/specs` or `docs/superpowers-optimized/plans`.

That artifact-triggered path does not auto-start when the current action is design-doc/spec editing or review.

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

Current safe default is `10`, clamped to `1..30`.

## Bootstrap Installation

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

Hosted curl piping is **not** the current supported path for this repo as-is, because `scripts/install-autopilot.mjs` imports `../dist/bootstrap.js` and is not a stdin-standalone artifact. If you later publish a hosted standalone installer, the UX could look like this illustrative future example:

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
- the Superpowers plugin entry is declared
- the managed autopilot agents are provisioned
- `autopilot-orchestrator` is available as the managed default agent when no conflicting default is already pinned
- the installer reports readiness after validating the merged config

### Supported assumptions

This bootstrap path assumes:

- OpenCode configuration is stored in a writable local JSON file
- the installer can back up and rewrite that file safely
- local agent provisioning is acceptable for slim-style specialist setup

This task does **not** provide full runtime autopilot behavior parity with upstream slim automation hooks, and it does **not** support remote-managed or immutable OpenCode config stores.

### Local verification

That dry-run package script sets `AUTOPILOT_DRY_RUN=1`, so it simulates the merge, reports readiness from the simulated merged config, and does not rewrite the file. The bootstrap wizard's emitted `next` command should match these npm-script forms rather than recommending direct `node scripts/install-autopilot.mjs` usage.

If you want a standalone readiness report without applying changes, use:

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

Expected result:

```text
22 pass
0 fail
```

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

## License

MIT
