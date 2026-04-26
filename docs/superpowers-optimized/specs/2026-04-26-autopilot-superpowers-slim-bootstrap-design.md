# Autopilot Superpowers + Slim Bootstrap Design

## Scope

Turn this autopilot plugin into a zero-manual-setup bootstrap for OpenCode that:

- installs or wires in the local autopilot plugin through a curl-based installer flow
- ensures `obra/superpowers` is present in OpenCode plugin config
- provisions orchestrator and specialist agents/subagents using the `oh-my-opencode-slim` model and routing style
- aligns the primary autopilot agent prompt and continuation behavior with slim-style orchestrator logic
- auto-starts autopilot for FULL tasks and active superpowers execution paths once readiness checks pass

The implementation applies to installer/bootstrap assets, plugin runtime logic in `src/`, and README/setup documentation.

## Non-Goals

- No exact 1:1 runtime reimplementation of every upstream `oh-my-opencode-slim` hook or council feature.
- No support target outside OpenCode environments with plugin support and Git plus Node/Bun available.
- No destructive overwrite of existing user OpenCode config.
- No automatic remote self-update loop for upstream dependencies without user initiation.
- No guarantee that every upstream superpowers or slim change is adopted immediately; compatibility is via a supported integration contract.

## Architecture And Data Flow

The system is split into three layers:

1. **Bootstrap layer** — a curl-invoked installer script prepares the environment, backs up config, ensures required plugins are declared, provisions agent definitions, and validates setup.
2. **Policy layer** — `obra/superpowers` remains the workflow authority for complexity routing, design/plan/execute discipline, and completion gates.
3. **Runtime orchestration layer** — this autopilot plugin becomes the loop controller and readiness gate. It injects orchestrator-style startup and continuation prompts, auto-activates for FULL tasks, and prefers slim-provisioned subagents while allowing controlled fallback to built-in agents.

Target flow:

```text
curl bootstrap
  -> detect OpenCode + config
  -> backup config
  -> ensure superpowers plugin entry exists
  -> install/register local autopilot plugin
  -> provision slim-style agent definitions
  -> merge config safely
  -> validate final environment

runtime task
  -> superpowers classifies task
  -> autopilot readiness check
  -> if FULL and ready, autopilot auto-enables
  -> startup prompt enforces orchestrator-first delegation
  -> idle loop continues using orchestrator-aligned guidance
```

## Interfaces And Contracts

### Bootstrap contract

Add a curl-friendly installer entrypoint that guarantees the following outcomes when successful:

- local autopilot plugin file is installed or refreshed
- `opencode.json` contains a valid declaration for the `obra/superpowers` dependency, with `superpowers@git+https://github.com/obra/superpowers.git` as the preferred default format
- OpenCode config contains provisioned agent definitions required by this plugin
- existing config is backed up before mutation
- validation output clearly states success, warning, or blocked state

The installer must operate as a wizard, not a silent fire-and-forget script. It may auto-apply safe steps, but each major step must be surfaced to the user with status.

### Config merge contract

Config changes must follow these rules:

- backup existing config first
- merge rather than overwrite whenever possible
- preserve existing unrelated user settings
- warn on conflicts
- only force required minimum entries for autopilot + superpowers + provisioned orchestrator defaults

Merge precedence is section-specific:

- unrelated existing config -> always preserve
- plugin list -> append missing required entries; never remove existing entries
- provisioned agent entries missing entirely -> add automatically
- existing agent entry with same ID but missing required fields -> merge missing required fields and warn
- existing agent entry with same ID but incompatible role/prompt behavior -> block and ask user whether to replace or keep existing entry
- default-agent/orchestrator setting -> set automatically only when absent or clearly pointing to the previous autopilot-managed value; otherwise warn and preserve

Blocking conflicts are limited to cases where the plugin cannot guarantee a working orchestrator path after merge. Non-blocking conflicts should preserve user state and enter degraded mode with clear warnings.

### Runtime readiness contract

Before FULL-task auto-execution, the plugin must determine whether the environment is ready:

- superpowers plugin declared and available
- local autopilot plugin available
- slim-style orchestrator agent available
- required specialist agent set present, or fallback map available

If readiness fails, autopilot must not enter normal FULL execution. It should emit a focused remediation message pointing to the curl bootstrap flow or a local readiness-check command implemented by this plugin.

### Agent orchestration contract

The primary agent prompt must behave like an orchestrator, not a default implementer:

- delegate first for exploration, implementation, and review
- parallelize independent tasks
- stop for approvals, ambiguity, high-risk decisions, and branch outcomes
- prefer slim-provisioned agents
- fallback to built-in agents only when the mapped slim role is unavailable

Minimum canonical role families to provision or emulate:

- orchestrator
- explorer
- implementer
- knowledge
- designer
- reviewer

Compatibility aliases may be mentioned in docs, but code, config, and tests must use the canonical names above.

### Provisioned agent manifest contract

The provisioned environment must expose a deterministic manifest with these canonical agent IDs:

- `autopilot-orchestrator`
- `autopilot-explorer`
- `autopilot-implementer`
- `autopilot-knowledge`
- `autopilot-designer`
- `autopilot-reviewer`

Each manifest entry must define:

- agent ID
- role family
- whether it is a primary agent or delegated specialist
- minimum prompt responsibility
- allowed MCP/tool surface if applicable
- fallback target when unavailable

Required fallback map:

- `autopilot-orchestrator` -> no fallback; missing orchestrator is a readiness failure
- `autopilot-explorer` -> built-in exploration/read specialist
- `autopilot-implementer` -> built-in implementation specialist
- `autopilot-knowledge` -> built-in documentation/context specialist
- `autopilot-designer` -> built-in design/planning specialist
- `autopilot-reviewer` -> built-in review/verification specialist

Provisioned config must be written in the OpenCode config location used by the current installation. Tests should validate IDs and fallback entries directly.

## Bootstrap Design

The curl setup should be the primary entrypoint for new users.

### Wizard steps

1. Detect OpenCode installation and config path.
2. Detect Git and runtime prerequisites.
3. Read and back up current `opencode.json`.
4. Ensure the superpowers plugin entry exists; add it if missing.
5. Install or refresh the local autopilot plugin assets.
6. Provision slim-style agent and subagent definitions into the OpenCode environment.
7. Merge config defaults for orchestrator behavior and agent availability.
8. Validate plugin and agent readiness.
9. Print next-step guidance and a concise setup summary.

### Provisioning strategy

Use a managed provisioning model rather than relying on a fragile full runtime dependency on the upstream slim plugin. The implementation should adopt slim's agent roles and orchestration logic, but this plugin owns the install path and compatibility layer so one curl command remains reliable.

That means:

- mirror the role model and routing policy from slim
- provision compatible local agent definitions/config through this plugin
- keep upstream slim as the design reference, not as a mandatory opaque runtime dependency

This preserves zero-manual-setup and reduces breakage from upstream internal changes.

## Runtime Prompt And Orchestration Design

`buildStartupInstructions()` and continuation prompts must be rewritten around orchestrator behavior.

### Required startup prompt behavior

The startup prompt must explicitly state:

- superpowers is the workflow policy layer
- the active agent is the orchestrator
- orchestrator should not default to inline implementation when delegation is available
- FULL tasks auto-run under autopilot once readiness checks pass
- slim-style specialists are preferred for delegated work
- fallback to built-in specialists is allowed only when a mapped slim specialist is unavailable

### Delegation policy

At minimum, the prompt logic should encode:

- exploration and code reading -> `autopilot-explorer`
- implementation or bug fixing -> `autopilot-implementer`
- documentation or repository facts -> `autopilot-knowledge`
- design ambiguity or architecture work -> `autopilot-designer`, then superpowers design workflow
- independent work items -> parallel delegation wave
- final synthesis and user-facing decision checkpoints -> `autopilot-orchestrator`

### Continuation policy

Idle continuation prompts should reinforce orchestrator discipline rather than generic “continue” messaging. They should bias toward:

- checking whether delegation happened
- pushing the next concrete delegated step
- avoiding broad re-exploration
- preserving stop conditions for ambiguity, blockers, and irreversible choices

## Auto-Activation Rules

Autopilot should auto-start when all of the following are true:

1. readiness checks pass
2. the current path is a superpowers technical workflow path
3. at least one positive execution trigger is present

### Detection matrix

#### Readiness signals

All of these are required:

- OpenCode config is readable
- `obra/superpowers` dependency is declared in accepted format
- local autopilot plugin is installed and loadable
- `autopilot-orchestrator` exists in provisioned config
- either all required canonical specialist IDs exist, or every missing one has a declared fallback target

#### Positive execution triggers

At least one of these must be true, evaluated in order:

1. **FULL-task classification trigger** — the active workflow context explicitly classifies the task as FULL.
2. **Artifact trigger** — an active superpowers implementation artifact exists in the current project, limited to approved design/spec/plan files under `docs/superpowers-optimized/specs/` or `docs/superpowers-optimized/plans/`, and the current session is acting on that artifact rather than merely editing documentation.
3. **Execution-context trigger** — the injected task context already indicates a superpowers technical execution path, such as explicit execute/build/fix/refactor work after planning or design approval.

#### Negative cases

Autopilot must not auto-start when any of these are true:

- the session is still in clarification or design-approval questioning
- the user is only reviewing or editing the design/spec document itself
- readiness checks fail
- the current step is a merge, PR, or branch outcome decision
- the task is MICRO or LIGHTWEIGHT and no higher-priority execution trigger is active

Priority order:

1. FULL-task classification
2. active superpowers implementation artifacts
3. active superpowers technical execution context

Autopilot should not auto-start during pure clarification, approval-only checkpoints, or bootstrap-remediation states.

## Error Handling

Bootstrap failures must be explicit and categorized:

- missing OpenCode
- unreadable or malformed config
- failed config backup
- failed plugin provisioning
- failed agent provisioning
- validation mismatch after write

Runtime failures must distinguish between:

- not-ready environment -> stop and remediate
- missing preferred specialist -> use fallback if allowed
- conflicting config assumptions -> warn and continue conservatively
- blocked execution -> stop and ask user or follow superpowers stop gate

## Testing Strategy

Add or update tests to cover:

1. config merge adds superpowers plugin entry without deleting unrelated user config
2. bootstrap path creates backup before mutation
3. bootstrap validation detects missing orchestrator/specialists
4. startup prompt contains orchestrator-first and superpowers policy language
5. FULL task with ready environment auto-enables autopilot
6. non-ready environment prevents FULL auto-execution and emits remediation guidance
7. slim-role preferred routing falls back safely when a mapped specialist is missing
8. README/setup docs match actual bootstrap commands and supported assumptions

## Rollout Notes

Rollout should be staged:

1. introduce bootstrap assets and documentation
2. add readiness checks and remediation messaging
3. update startup/continuation prompts to orchestrator style
4. enable FULL-task auto-activation only after readiness and tests are stable

During rollout, the existing lightweight autopilot behavior may remain for environments not yet bootstrapped, but FULL-task strict mode should only be enabled after readiness is implemented.

## Failure-Mode Check

### Critical: Config merge breaks existing user setup

The design addresses this by requiring backup-first mutation, merge-overwrite policy, and conflict warnings. Forced writes are limited to the minimum viable integration surface.

### Critical: Upstream superpowers or slim evolves and integration drifts

The design reduces this risk by treating superpowers as a declared plugin dependency and slim as a role/prompt/provisioning reference instead of requiring an exact internal runtime clone.

### Critical: Autopilot auto-start becomes too aggressive

The design constrains auto-start to ready FULL-task or active superpowers execution conditions only. Clarification and approval phases remain blocked from auto-start.

### Minor: Fallback agents may not behave exactly like slim specialists

This is acceptable as a compatibility fallback, not the preferred path. The behavior should be documented as degraded mode rather than presented as full equivalence.
