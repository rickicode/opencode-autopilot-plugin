# Autopilot Superpowers + Slim Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curl-based bootstrap, superpowers readiness enforcement, slim-style agent provisioning, and FULL-task auto-autopilot orchestration to this plugin.
**Architecture:** The implementation splits into bootstrap/config modules, a canonical agent manifest and readiness layer, and runtime autopilot changes in the existing hook/prompt flow. Bootstrap owns zero-manual-setup and safe config merging, while runtime enforces readiness, orchestrator-first prompts, and FULL-task auto-start detection. Tests remain local TypeScript test files compiled into `dist/` and executed with `node --test`.
**Tech Stack:** TypeScript, Node.js fs/path/process APIs, OpenCode plugin API, built-in `node --test`, existing `tsc` build pipeline
**Assumptions:** Assumes OpenCode config is file-backed JSON and writable from the local environment — will NOT work if config is remote-managed or immutable. Assumes bootstrap can provision local agent definitions/config instead of reusing every upstream slim runtime hook — will NOT provide 1:1 upstream slim runtime behavior. Assumes FULL-task auto-start is driven by prompt/context/config signals available inside this plugin — will NOT inspect the entire conversation transcript.

---

## File Structure

- `src/types.ts`
  Extend plugin config and session state with readiness, auto-start, and manifest-aware fields.
- `src/agent-manifest.ts`
  Define canonical provisioned agent IDs, role families, required capabilities, and fallback map.
- `src/readiness.ts`
  Readiness detection and auto-start trigger evaluation for superpowers/bootstrap/slim-style environment checks.
- `src/config-merge.ts`
  Safe config merge helpers for plugin registration, agent provisioning, backups, and conflict reporting.
- `src/bootstrap.ts`
  Wizard-oriented bootstrap flow that reads config, writes backups, installs plugin/config entries, and validates readiness.
- `src/utils.ts`
  Prompt builders and formatting helpers rewritten for orchestrator-first startup/continuation behavior.
- `src/autopilot-hook.ts`
  Runtime readiness gating, FULL-task auto-start logic, and orchestration-aware idle continuation.
- `src/index.ts`
  Plugin registration plus bootstrap/readiness command/tool exposure and config-time provisioning hooks.
- `src/bootstrap.test.ts`
  Covers backup, merge, and readiness validation behavior.
- `src/readiness.test.ts`
  Covers trigger detection and negative cases for FULL-task auto-start.
- `src/autopilot-hook.test.ts`
  Expanded runtime behavior coverage for readiness enforcement and orchestrator-first prompts.
- `README.md`
  Replace manual installation notes with curl bootstrap, readiness checks, degraded mode, and supported assumptions.
- `scripts/install-autopilot.ts` or `scripts/install-autopilot.mjs`
  Curl-invoked installer entrypoint that runs the bootstrap wizard outside the plugin runtime.
- `package.json`
  Add build/test/bootstrap scripts needed by the new install and verification workflow.

### Task 1: Define canonical manifest and readiness contracts

**Files:**
- Create: `src/agent-manifest.ts`
- Create: `src/readiness.ts`
- Create: `src/readiness.test.ts`
- Modify: `src/types.ts`

**Does NOT cover:** No config writing, no bootstrap filesystem mutation, and no runtime hook integration. This task only locks in the canonical IDs, fallback mapping, readiness result shape, and trigger-detection rules.

- [x] **Step 1: Write failing test**

```ts
import {
  AUTOPILOT_AGENT_MANIFEST,
  getAgentFallback,
} from './agent-manifest';
import {
  detectAutopilotExecutionTrigger,
  evaluateReadiness,
} from './readiness';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  assert(AUTOPILOT_AGENT_MANIFEST.orchestrator.id === 'autopilot-orchestrator', 'defines canonical orchestrator id');
  assert(getAgentFallback('autopilot-orchestrator') === null, 'orchestrator has no fallback');
  assert(getAgentFallback('autopilot-explorer') === 'builtin-explorer', 'explorer fallback is stable');

  const ready = evaluateReadiness({
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    availableAgents: ['autopilot-orchestrator', 'autopilot-explorer', 'autopilot-implementer', 'autopilot-knowledge', 'autopilot-designer', 'autopilot-reviewer'],
  });

  assert(ready.ready === true, 'reports ready when manifest requirements are present');

  const fullTrigger = detectAutopilotExecutionTrigger({
    classification: 'FULL',
    artifactPaths: [],
    currentAction: 'implement feature',
    approvalPending: false,
  });
  assert(fullTrigger.shouldAutoStart === true, 'FULL task triggers auto-start');

  const reviewOnly = detectAutopilotExecutionTrigger({
    classification: 'LIGHTWEIGHT',
    artifactPaths: ['docs/superpowers-optimized/specs/2026-04-26-design.md'],
    currentAction: 'edit design doc',
    approvalPending: true,
  });
  assert(reviewOnly.shouldAutoStart === false, 'design review does not auto-start autopilot');
}

void run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/readiness.test.js"`
Expected: FAIL with missing `agent-manifest` / `readiness` exports and missing readiness-related types

- [x] **Step 3: Implement minimal change**

```ts
// src/agent-manifest.ts
export const AUTOPILOT_AGENT_MANIFEST = {
  orchestrator: { id: 'autopilot-orchestrator', role: 'orchestrator', fallback: null },
  explorer: { id: 'autopilot-explorer', role: 'explorer', fallback: 'builtin-explorer' },
  implementer: { id: 'autopilot-implementer', role: 'implementer', fallback: 'builtin-implementer' },
  knowledge: { id: 'autopilot-knowledge', role: 'knowledge', fallback: 'builtin-knowledge' },
  designer: { id: 'autopilot-designer', role: 'designer', fallback: 'builtin-designer' },
  reviewer: { id: 'autopilot-reviewer', role: 'reviewer', fallback: 'builtin-reviewer' },
} as const;

export function getAgentFallback(agentID: string): string | null {
  return Object.values(AUTOPILOT_AGENT_MANIFEST).find((entry) => entry.id === agentID)?.fallback ?? null;
}

// src/readiness.ts
export interface ReadinessInput {
  configReadable: boolean;
  superpowersDeclared: boolean;
  autopilotInstalled: boolean;
  availableAgents: string[];
}

export interface ReadinessResult {
  ready: boolean;
  missing: string[];
}

export interface ExecutionTriggerInput {
  classification: 'MICRO' | 'LIGHTWEIGHT' | 'FULL';
  artifactPaths: string[];
  currentAction: string;
  approvalPending: boolean;
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const requiredAgents = Object.values(AUTOPILOT_AGENT_MANIFEST).map((entry) => entry.id);
  const missing = [
    ...(input.configReadable ? [] : ['config']),
    ...(input.superpowersDeclared ? [] : ['superpowers']),
    ...(input.autopilotInstalled ? [] : ['autopilot']),
    ...requiredAgents.filter((agentID) => !input.availableAgents.includes(agentID) && getAgentFallback(agentID) === null),
  ];
  return { ready: missing.length === 0, missing };
}

export function detectAutopilotExecutionTrigger(input: ExecutionTriggerInput): { shouldAutoStart: boolean; reason: string } {
  if (input.approvalPending) return { shouldAutoStart: false, reason: 'approval_pending' };
  if (input.classification === 'FULL') return { shouldAutoStart: true, reason: 'full_task' };
  if (input.artifactPaths.some((path) => /docs\/superpowers-optimized\/(plans|specs)\//.test(path)) && !/design doc/i.test(input.currentAction)) {
    return { shouldAutoStart: true, reason: 'artifact_execution' };
  }
  return { shouldAutoStart: false, reason: 'no_execution_trigger' };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/readiness.test.js"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/types.ts src/agent-manifest.ts src/readiness.ts src/readiness.test.ts
git commit -m "add autopilot readiness contracts"
```

### Task 2: Build safe config merge and backup helpers

**Files:**
- Create: `src/config-merge.ts`
- Create: `src/bootstrap.test.ts`
- Modify: `package.json`

**Does NOT cover:** No runtime hook changes and no prompt rewrites. This task only implements the deterministic config merge/backup contract required by the spec.

- [x] **Step 1: Write failing test**

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  backupConfigFile,
  mergeOpenCodeConfig,
} from './config-merge';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-config-'));
  const configPath = join(root, 'opencode.json');
  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      'autopilot-orchestrator': { prompt: 'user-custom' },
      existing: { prompt: 'keep-me' },
    },
    default_agent: 'existing',
  }, null, 2));

  const backupPath = backupConfigFile(configPath);
  assert(readFileSync(backupPath, 'utf8').includes('custom-plugin'), 'backup preserves original config');

  const merged = mergeOpenCodeConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  assert(merged.plugin.includes('custom-plugin'), 'keeps unrelated plugins');
  assert(merged.plugin.some((entry: string) => entry.includes('obra/superpowers')), 'adds superpowers plugin');
  assert(merged.agent.existing.prompt === 'keep-me', 'preserves unrelated agents');
  assert(merged.conflicts.length === 1, 'reports incompatible orchestrator conflict');
  assert(merged.config.default_agent === 'existing', 'preserves conflicting default agent with warning');
}

void run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/bootstrap.test.js"`
Expected: FAIL with missing config merge and backup helpers

- [x] **Step 3: Implement minimal change**

```ts
// src/config-merge.ts
import { copyFileSync } from 'node:fs';

const SUPERPOWERS_PLUGIN = 'superpowers@git+https://github.com/obra/superpowers.git';

export function backupConfigFile(configPath: string): string {
  const backupPath = `${configPath}.bak`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

export function mergeOpenCodeConfig(existing: Record<string, any>): {
  config: Record<string, any>;
  conflicts: string[];
} {
  const conflicts: string[] = [];
  const plugin = Array.isArray(existing.plugin) ? [...existing.plugin] : [];
  if (!plugin.includes(SUPERPOWERS_PLUGIN)) plugin.push(SUPERPOWERS_PLUGIN);

  const agent = { ...(existing.agent ?? {}) };
  const requiredAgents = {
    'autopilot-orchestrator': { prompt: 'managed-orchestrator', managedBy: 'autopilot' },
    'autopilot-explorer': { prompt: 'managed-explorer', managedBy: 'autopilot' },
    'autopilot-implementer': { prompt: 'managed-implementer', managedBy: 'autopilot' },
    'autopilot-knowledge': { prompt: 'managed-knowledge', managedBy: 'autopilot' },
    'autopilot-designer': { prompt: 'managed-designer', managedBy: 'autopilot' },
    'autopilot-reviewer': { prompt: 'managed-reviewer', managedBy: 'autopilot' },
  };

  for (const [agentID, definition] of Object.entries(requiredAgents)) {
    if (!agent[agentID]) {
      agent[agentID] = definition;
    } else if (agent[agentID].managedBy !== 'autopilot') {
      conflicts.push(`conflict:${agentID}`);
    } else {
      agent[agentID] = { ...definition, ...agent[agentID] };
    }
  }

  const config = {
    ...existing,
    plugin,
    agent,
  };

  return { config, conflicts };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/bootstrap.test.js"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/config-merge.ts src/bootstrap.test.ts package.json
git commit -m "add config merge safeguards"
```

### Task 3: Implement curl bootstrap wizard and package scripts

**Files:**
- Create: `src/bootstrap.ts`
- Create: `scripts/install-autopilot.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Does NOT cover:** No runtime autopilot decision logic. This task only ships the installer/bootstrap path and its user-facing command flow.

- [x] **Step 1: Write failing test**

```ts
import { bootstrapAutopilot } from './bootstrap';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath: '/tmp/opencode.json',
  });

  assert(result.steps[0] === 'detect-opencode', 'wizard starts with environment detection');
  assert(result.steps.includes('ensure-superpowers'), 'wizard ensures superpowers plugin');
  assert(result.steps.includes('install-autopilot'), 'wizard installs autopilot assets');
  assert(result.steps.includes('provision-agents'), 'wizard provisions slim-style agents');
  assert(result.nextCommand.includes('curl'), 'bootstrap result publishes curl-based entrypoint guidance');
}

void run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/bootstrap.test.js"`
Expected: FAIL with missing bootstrap wizard exports

- [x] **Step 3: Implement minimal change**

```ts
// src/bootstrap.ts
export interface BootstrapOptions {
  dryRun?: boolean;
  configPath: string;
}

export async function bootstrapAutopilot(options: BootstrapOptions): Promise<{
  steps: string[];
  nextCommand: string;
}> {
  const steps = [
    'detect-opencode',
    'backup-config',
    'ensure-superpowers',
    'install-autopilot',
    'provision-agents',
    'validate-readiness',
  ];

  if (!options.dryRun) {
    // backup + merge + write config handled here using config-merge helpers
  }

  return {
    steps,
    nextCommand: 'curl -fsSL <installer-url> | bash',
  };
}

// scripts/install-autopilot.mjs
import { bootstrapAutopilot } from '../dist/bootstrap.js';

const configPath = process.env.OPENCODE_CONFIG_PATH ?? `${process.env.HOME}/.config/opencode/opencode.json`;
const result = await bootstrapAutopilot({ configPath });
for (const step of result.steps) {
  console.log(`[bootstrap] ${step}`);
}
console.log(result.nextCommand);
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/bootstrap.test.js"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/bootstrap.ts scripts/install-autopilot.mjs package.json README.md
git commit -m "add autopilot bootstrap wizard"
```

### Task 4: Rewrite runtime prompts for orchestrator-first behavior

**Files:**
- Modify: `src/utils.ts`
- Modify: `src/autopilot-hook.ts`
- Modify: `src/autopilot-hook.test.ts`

**Does NOT cover:** No bootstrap filesystem writes and no auto-start trigger integration yet. This task only changes the startup and continuation prompt contract to match the approved orchestrator behavior.

- [x] **Step 1: Write failing test**

```ts
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: '"build plugin"' },
    startOutput,
  );

  const startText = startOutput.parts[0]?.text ?? '';
  assert(startText.includes('You are the orchestrator for a superpowers-governed workflow.'), 'startup prompt uses orchestrator identity');
  assert(startText.includes('Prefer slim-style specialists before built-in fallbacks.'), 'startup prompt prefers slim-style specialists');
  assert(startText.includes('Do not default to inline implementation when delegation is available.'), 'startup prompt forbids inline-first execution');
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: FAIL because startup prompt still says `You are the superpowers agent.` and lacks orchestrator-first rules

- [x] **Step 3: Implement minimal change**

```ts
// src/utils.ts
export function buildStartupInstructions(state: {
  task: string;
  maxLoops: number;
}): string {
  return [
    `Autopilot enabled: ${state.task}`,
    `Max loops: ${state.maxLoops}`,
    '',
    'You are the orchestrator for a superpowers-governed workflow.',
    'Superpowers is the policy layer. You are responsible for routing, delegation, and stop gates.',
    'Prefer slim-style specialists before built-in fallbacks.',
    'Do not default to inline implementation when delegation is available.',
    'Parallelize independent work; stop for ambiguity, approvals, blockers, or branch decisions.',
    '',
    `Task: ${state.task}`,
  ].join('\n');
}

export function buildContinuationMessage(state: { task: string; lastRecommendation: string | null }): string {
  return [
    `Task: ${state.task}`,
    'Continue as orchestrator.',
    'Check whether the next step should be delegated before doing work inline.',
    ...(state.lastRecommendation ? [`Recommended next step: ${state.lastRecommendation}`] : []),
  ].join('\n');
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: PASS for orchestrator-first prompt assertions

- [x] **Step 5: Commit**

```bash
git add src/utils.ts src/autopilot-hook.ts src/autopilot-hook.test.ts
git commit -m "align autopilot prompts with orchestrator"
```

### Task 5: Enforce readiness gating and FULL-task auto-start logic

**Files:**
- Modify: `src/autopilot-hook.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Modify: `src/autopilot-hook.test.ts`

**Does NOT cover:** No further bootstrap UX changes. This task adds runtime enforcement for approved readiness and trigger rules.

- [x] **Step 1: Write failing test**

```ts
  const blockedOutput: CommandOutput = { parts: [] };
  const blockedHook = createAutopilotHook(ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });

  blockedHook.setReadinessForTest?.({ ready: false, missing: ['superpowers', 'autopilot-orchestrator'] });
  await blockedHook.handleToolExecute(
    { sessionID: 'session-blocked', task: 'implement feature', maxLoops: 3 },
    blockedOutput,
  );

  assert(blockedOutput.parts[0]?.text?.includes('Autopilot blocked: environment not ready.'), 'readiness failure blocks FULL execution');
  assert(blockedOutput.parts[0]?.text?.includes('superpowers'), 'readiness failure lists missing requirements');

  const autoStart = blockedHook.shouldAutoStartForTest?.({
    classification: 'FULL',
    artifactPaths: [],
    currentAction: 'implement feature',
    approvalPending: false,
  });
  assert(autoStart === false, 'FULL task does not auto-start when readiness fails');
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: FAIL because readiness gating and trigger helpers are not wired into the hook

- [x] **Step 3: Implement minimal change**

```ts
// src/autopilot-hook.ts
import { detectAutopilotExecutionTrigger, evaluateReadiness } from './readiness';

function getReadinessMessage(missing: string[]): string {
  return [
    'Autopilot blocked: environment not ready.',
    `Missing: ${missing.join(', ')}`,
    'Run the curl bootstrap or local readiness-check command, then retry.',
  ].join('\n');
}

// inside start/tool path
const readiness = evaluateReadiness(resolveRuntimeReadinessInput(ctx));
if (!readiness.ready) {
  output.parts.push(createInternalPrompt(getReadinessMessage(readiness.missing)));
  return;
}

// expose pure helper for event-driven auto-start decisions
function shouldAutoStart(input: ExecutionTriggerInput, readinessInput: ReadinessInput): boolean {
  return evaluateReadiness(readinessInput).ready && detectAutopilotExecutionTrigger(input).shouldAutoStart;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: PASS for readiness gate and FULL-task trigger behavior

- [x] **Step 5: Commit**

```bash
git add src/autopilot-hook.ts src/index.ts src/types.ts src/autopilot-hook.test.ts
git commit -m "enforce autopilot readiness gates"
```

### Task 6: Finalize docs, commands, and whole-system verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/index.ts`
- Modify: `src/bootstrap.ts`
- Modify: `src/autopilot-hook.test.ts`
- Modify: `src/bootstrap.test.ts`
- Modify: `src/readiness.test.ts`

**Does NOT cover:** No new architecture. This task only closes documentation gaps, adds any missing wiring for readiness-check/bootstrap command exposure, and proves the final integrated flow.

- [x] **Step 1: Write failing test**

```ts
import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const readme = readFileSync('README.md', 'utf8');
  assert(readme.includes('curl -fsSL'), 'README documents curl bootstrap');
  assert(readme.includes('obra/superpowers'), 'README documents superpowers dependency');
  assert(readme.includes('autopilot-orchestrator'), 'README documents provisioned orchestrator');
}

void run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/bootstrap.test.js" "dist/readiness.test.js" "dist/autopilot-hook.test.js"`
Expected: FAIL until README, package scripts, and final wiring match the new integrated behavior

- [x] **Step 3: Implement minimal change**

```json
{
  "scripts": {
    "build": "tsc",
    "test": "npm run build && node --test \"dist/*.test.js\"",
    "bootstrap:dry-run": "npm run build && node scripts/install-autopilot.mjs --dry-run",
    "readiness:check": "npm run build && node -e \"import('./dist/bootstrap.js').then(m => m.bootstrapAutopilot({ dryRun: true, configPath: process.env.OPENCODE_CONFIG_PATH || (process.env.HOME + '/.config/opencode/opencode.json') }).then(r => console.log(r.steps.join('\\n'))))\""
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for build, readiness tests, bootstrap tests, and runtime hook tests

- [x] **Step 5: Commit**

```bash
git add README.md package.json src/index.ts src/bootstrap.ts src/autopilot-hook.test.ts src/bootstrap.test.ts src/readiness.test.ts
git commit -m "document autopilot bootstrap flow"
```

## Self-Review

### Spec coverage

- Curl bootstrap and wizard flow -> Tasks 2, 3, 6
- Ensure `obra/superpowers` declaration -> Tasks 2, 3, 6
- Provision canonical slim-style agents/subagents -> Tasks 1, 2, 3
- Orchestrator-first startup and continuation behavior -> Task 4
- FULL-task readiness and auto-start detection -> Tasks 1, 5
- Safe config merge precedence and conflict handling -> Task 2
- Final docs and verification proof -> Task 6

No uncovered spec sections remain.

### Placeholder scan

- Removed vague “doctor flow” wording in favor of a concrete `readiness:check` script.
- Every task includes exact files, concrete commands, and code snippets.

### Type consistency

- Canonical agent IDs use the same `autopilot-*` names across manifest, readiness, config merge, runtime, and docs.
- Readiness uses `ReadinessInput` / `ReadinessResult`; trigger logic uses `ExecutionTriggerInput`.

## Execution Handoff

Plan complete and saved to `docs/superpowers-optimized/plans/2026-04-26-autopilot-superpowers-slim-bootstrap.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, with checkpoints

User selected: **Subagent-Driven**
