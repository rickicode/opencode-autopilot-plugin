# Native Superpowers Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename managed agents to native `superpowers` names and make `superpowers` auto-handoff to autopilot only after approved spec and plan artifacts are present.

**Architecture:** Keep the primary runtime agent as `superpowers` and rename managed subagents to a unique but readable canonical set: `superpowers-explorer`, `superpowers-implementer`, `superpowers-knowledge`, `superpowers-designer`, `superpowers-reviewer`. Move readiness and auto-start logic from generic FULL-task triggering to artifact-driven execution that requires both spec and plan approval, while keeping edit/review guardrails. Update the local OpenCode config separately so legacy `autopilot-*` entries disappear from the user's machine without preserving compatibility logic in source.

**Tech Stack:** TypeScript, Node.js built-in test runner, OpenCode plugin hooks, JSON config bootstrap flow

---

## File Structure

- Modify: `src/agent-manifest.ts` — redefine canonical managed IDs to the `superpowers-*` subagent names and keep fallback behavior stable.
- Modify: `src/config-merge.ts` — provision only `superpowers-*` managed subagents, set `default_agent` to `superpowers`, and remove legacy-prefixed assumptions from merge logic.
- Modify: `src/bootstrap.ts` — compute readiness from `superpowers` instead of `autopilot-superpowers`.
- Modify: `src/readiness.ts` — require approved spec+plan artifacts for auto-start, remove FULL classification auto-start, and preserve edit/review guards.
- Modify: `src/bootstrap.test.ts` — lock clean managed names, default agent, config merge behavior, and bootstrap readiness semantics.
- Modify: `src/readiness.test.ts` — lock canonical IDs, readiness checks, and approved-artifact auto-start behavior.
- Modify: `src/autopilot-hook.test.ts` — update expected available agent IDs to clean names.
- Modify: `README.md` — document clean managed names and approved artifact-triggered native execution.
- Modify: `AUTOPILOT_SUPERPOWERS.md` — replace outdated `autopilot-*` source-of-truth statements.
- Modify local config only: `/home/ricki/.config/opencode/opencode.json` — remove old `autopilot-*` agent entries and sync to clean names after code changes are verified.

### Task 1: Rename Canonical Managed Agent IDs

**Files:**
- Modify: `src/agent-manifest.ts`
- Test: `src/readiness.test.ts`

- [ ] **Step 1: Write the failing manifest expectation test**

```ts
test('manifest exposes native superpowers managed agent ids', () => {
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.id, 'superpowers');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.id, 'superpowers-explorer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.implementer.id, 'superpowers-implementer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.knowledge.id, 'superpowers-knowledge');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.designer.id, 'superpowers-designer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.reviewer.id, 'superpowers-reviewer');
});
```

- [ ] **Step 2: Run the manifest/readiness test to verify it fails**

Run: `npm test -- --test-name-pattern="manifest exposes native superpowers managed agent ids"`
Expected: FAIL because the manifest still returns `autopilot-*` IDs.

- [ ] **Step 3: Implement the canonical ID rename**

```ts
export const AUTOPILOT_AGENT_MANIFEST: AutopilotAgentManifest = {
  superpowers: {
    id: 'superpowers',
    role: 'superpowers',
    roleFamily: 'orchestration',
    agentKind: 'primary',
    minimumPromptResponsibility:
      'Own end-to-end task orchestration and decide when delegated specialists are needed.',
    allowedToolSurface: [],
    fallbackTarget: null,
  },
  explorer: {
    id: 'superpowers-explorer',
    role: 'explorer',
    roleFamily: 'exploration',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Inspect repository structure and gather relevant code context before execution.',
    allowedToolSurface: ['Read', 'Grep', 'Glob'],
    fallbackTarget: 'builtin-explorer',
  },
  implementer: {
    id: 'superpowers-implementer',
    role: 'implementer',
    roleFamily: 'implementation',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Apply the smallest validated code change that satisfies the current task contract.',
    allowedToolSurface: ['Read', 'Edit', 'Write', 'Bash'],
    fallbackTarget: 'builtin-implementer',
  },
  knowledge: {
    id: 'superpowers-knowledge',
    role: 'knowledge',
    roleFamily: 'knowledge',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Retrieve durable project facts, prior constraints, and supporting references.',
    allowedToolSurface: ['Read', 'Grep', 'WebFetch'],
    fallbackTarget: 'builtin-knowledge',
  },
  designer: {
    id: 'superpowers-designer',
    role: 'designer',
    roleFamily: 'design',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Shape implementation approach, acceptance boundaries, and task decomposition intent.',
    allowedToolSurface: ['Read', 'Write'],
    fallbackTarget: 'builtin-designer',
  },
  reviewer: {
    id: 'superpowers-reviewer',
    role: 'reviewer',
    roleFamily: 'review',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Verify requirement compliance, quality risks, and final readiness before completion.',
    allowedToolSurface: ['Read', 'Grep', 'Bash'],
    fallbackTarget: 'builtin-reviewer',
  },
};
```

- [ ] **Step 4: Run the focused readiness test to verify it passes**

Run: `npm test -- --test-name-pattern="manifest exposes native superpowers managed agent ids"`
Expected: PASS

- [ ] **Step 5: Commit the manifest rename**

```bash
git add src/agent-manifest.ts src/readiness.test.ts
git commit -m "refactor: rename managed agent ids"
```

### Task 2: Rewrite Config Merge Around Clean Managed Names

**Files:**
- Modify: `src/config-merge.ts`
- Test: `src/bootstrap.test.ts`

- [ ] **Step 1: Write the failing config-merge tests for clean names**

```ts
test('merge provisions only native superpowers managed agents', () => {
  const merged = mergeOpenCodeConfig({ plugin: ['custom-plugin'] });

  assert.ok(merged.config.agent.superpowers);
  assert.ok(merged.config.agent['superpowers-explorer']);
  assert.ok(merged.config.agent['superpowers-implementer']);
  assert.equal(merged.config.agent.superpowers.mode, 'primary');
  assert.equal(merged.config.agent['superpowers-explorer'].mode, 'subagent');
  assert.equal(merged.config.default_agent, 'superpowers');
  assert.equal(merged.config.agent['autopilot-superpowers'], undefined);
});

test('merge reports conflict when user-owned native subagent collides', () => {
  const merged = mergeOpenCodeConfig({
    agent: {
      'superpowers-explorer': { prompt: 'user-custom' },
    },
  });

  assert.deepEqual(merged.conflicts, ['agent.superpowers-explorer']);
  assert.equal(merged.config.agent['superpowers-explorer'].prompt, 'user-custom');
});
```

- [ ] **Step 2: Run the merge-focused tests to verify they fail**

Run: `npm test -- --test-name-pattern="merge provisions only native superpowers managed agents|merge reports conflict when user-owned native subagent collides"`
Expected: FAIL because the merge logic still provisions `autopilot-*` IDs and defaults.

- [ ] **Step 3: Implement the clean-name managed config merge**

```ts
const MANAGED_AGENT_DEFINITIONS = {
  superpowers: {
    description: 'Autopilot managed Superpowers primary agent',
    metadata: { owner: 'autopilot' },
    mode: 'primary',
  },
  'superpowers-explorer': {
    description: 'Autopilot managed explorer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-implementer': {
    description: 'Autopilot managed implementer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-knowledge': {
    description: 'Autopilot managed knowledge agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-designer': {
    description: 'Autopilot managed designer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-reviewer': {
    description: 'Autopilot managed reviewer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
} as const;

const desiredDefaultAgent = 'superpowers';
```

- [ ] **Step 4: Run the merge-focused tests to verify they pass**

Run: `npm test -- --test-name-pattern="merge provisions only native superpowers managed agents|merge reports conflict when user-owned native subagent collides"`
Expected: PASS

- [ ] **Step 5: Commit the config merge rewrite**

```bash
git add src/config-merge.ts src/bootstrap.test.ts
git commit -m "refactor: provision clean managed config agents"
```

### Task 3: Update Readiness to Require Approved Spec and Plan

**Files:**
- Modify: `src/readiness.ts`
- Modify: `src/types.ts`
- Test: `src/readiness.test.ts`

- [ ] **Step 1: Write the failing readiness trigger tests for approved artifacts**

```ts
test('detectAutopilotExecutionTrigger waits for approved spec and plan artifacts', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'FULL',
      approvalPending: false,
      currentAction: 'implement approved work',
      artifactPaths: [
        'docs/superpowers/specs/2026-04-26-native-superpowers-autopilot-approved.md',
        'docs/superpowers/plans/2026-04-26-native-superpowers-autopilot-approved.md',
      ],
    }),
    { shouldAutoStart: true, reason: 'artifact-execution' },
  );
});

test('detectAutopilotExecutionTrigger does not auto-start on FULL classification alone', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'FULL',
      approvalPending: false,
      currentAction: 'implement feature',
      artifactPaths: [],
    }),
    { shouldAutoStart: false, reason: 'no-trigger' },
  );
});
```

- [ ] **Step 2: Run the readiness trigger tests to verify they fail**

Run: `npm test -- --test-name-pattern="approved spec and plan artifacts|FULL classification alone"`
Expected: FAIL because current logic auto-starts on `FULL` and does not require approval markers on artifacts.

- [ ] **Step 3: Implement approved-artifact execution detection**

```ts
const APPROVED_ARTIFACT_PATTERN = /-approved\.md$/;

function hasApprovedSpecAndPlan(artifactPaths: string[]): boolean {
  const hasApprovedSpec = artifactPaths.some((artifactPath) =>
    /(^|\/)(docs\/superpowers\/specs)(\/|$)/.test(artifactPath) &&
    APPROVED_ARTIFACT_PATTERN.test(artifactPath),
  );
  const hasApprovedPlan = artifactPaths.some((artifactPath) =>
    /(^|\/)(docs\/superpowers\/plans)(\/|$)/.test(artifactPath) &&
    APPROVED_ARTIFACT_PATTERN.test(artifactPath),
  );

  return hasApprovedSpec && hasApprovedPlan;
}

export function detectAutopilotExecutionTrigger(
  input: ExecutionTriggerInput,
): ExecutionTriggerResult {
  if (!hasApprovedSpecAndPlan(input.artifactPaths)) {
    return { shouldAutoStart: false, reason: 'no-trigger' };
  }

  if (input.approvalPending) {
    return { shouldAutoStart: false, reason: 'approval-pending' };
  }

  if (isDesignDocAction(input.currentAction)) {
    return { shouldAutoStart: false, reason: 'design-doc-action' };
  }

  return { shouldAutoStart: true, reason: 'artifact-execution' };
}
```

- [ ] **Step 4: Run the readiness trigger tests to verify they pass**

Run: `npm test -- --test-name-pattern="approved spec and plan artifacts|FULL classification alone"`
Expected: PASS

- [ ] **Step 5: Commit the readiness trigger rewrite**

```bash
git add src/readiness.ts src/types.ts src/readiness.test.ts
git commit -m "feat: auto-start only from approved artifacts"
```

### Task 4: Align Bootstrap Readiness and Regression Tests

**Files:**
- Modify: `src/bootstrap.ts`
- Modify: `src/bootstrap.test.ts`
- Test: `src/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap readiness tests for `superpowers` install state**

```ts
test('getReadinessFromConfig treats clean superpowers agent as installed', () => {
  const readiness = getReadinessFromConfig({
    plugin: [SUPERPOWERS_PLUGIN],
    agent: {
      superpowers: { mode: 'primary' },
      'superpowers-explorer': { mode: 'subagent' },
      'superpowers-implementer': { mode: 'subagent' },
      'superpowers-knowledge': { mode: 'subagent' },
      'superpowers-designer': { mode: 'subagent' },
      'superpowers-reviewer': { mode: 'subagent' },
    },
  });

  assert.equal(readiness.autopilotInstalled, true);
  assert.equal(readiness.ready, true);
});
```

- [ ] **Step 2: Run the bootstrap readiness test to verify it fails**

Run: `npm test -- --test-name-pattern="clean superpowers agent as installed"`
Expected: FAIL because bootstrap readiness still looks for `autopilot-superpowers`.

- [ ] **Step 3: Implement clean-name readiness detection in bootstrap**

```ts
return evaluateReadiness({
  configReadable: true,
  superpowersDeclared: pluginEntries.some((entry) => entry === SUPERPOWERS_PLUGIN),
  autopilotInstalled: availableAgents.includes('superpowers'),
  availableAgents,
});
```

- [ ] **Step 4: Run the bootstrap readiness test to verify it passes**

Run: `npm test -- --test-name-pattern="clean superpowers agent as installed"`
Expected: PASS

- [ ] **Step 5: Commit the bootstrap readiness alignment**

```bash
git add src/bootstrap.ts src/bootstrap.test.ts
git commit -m "test: align bootstrap readiness with clean agent ids"
```

### Task 5: Update Integration Docs and Source-of-Truth Notes

**Files:**
- Modify: `README.md`
- Modify: `AUTOPILOT_SUPERPOWERS.md`
- Test: `src/bootstrap.test.ts`

- [ ] **Step 1: Write the failing documentation assertions**

```ts
test('README documents superpowers as the managed default agent', () => {
  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

  assert.match(readme, /`superpowers` is available as the managed default agent/i);
  assert.doesNotMatch(readme, /autopilot-superpowers/);
});

test('source of truth notes clean managed ids and approved artifact execution', () => {
  const designDoc = readFileSync(join(process.cwd(), 'AUTOPILOT_SUPERPOWERS.md'), 'utf8');

  assert.match(designDoc, /managed primary agent id is `superpowers`/i);
  assert.match(designDoc, /approved spec and plan artifacts gate execution/i);
});
```

- [ ] **Step 2: Run the documentation tests to verify they fail**

Run: `npm test -- --test-name-pattern="managed default agent|approved artifact execution"`
Expected: FAIL because docs still mention `autopilot-superpowers` and do not state the approved-artifact gate.

- [ ] **Step 3: Update the documentation text**

```md
- `superpowers` is available as the managed default agent when no conflicting default is already pinned
- managed primary agent id is `superpowers`
- approved spec and plan artifacts gate execution
```

- [ ] **Step 4: Run the documentation tests to verify they pass**

Run: `npm test -- --test-name-pattern="managed default agent|approved artifact execution"`
Expected: PASS

- [ ] **Step 5: Commit the docs alignment**

```bash
git add README.md AUTOPILOT_SUPERPOWERS.md src/bootstrap.test.ts
git commit -m "docs: align native superpowers autopilot flow"
```

### Task 6: Full Verification and Local OpenCode Config Sync

**Files:**
- Modify local config only: `/home/ricki/.config/opencode/opencode.json`
- Test: `src/autopilot-hook.test.ts`
- Test: `src/bootstrap.test.ts`
- Test: `src/readiness.test.ts`

- [ ] **Step 1: Add a full-suite expectation for clean available agent IDs**

```ts
  assert.deepEqual(readiness.availableAgents, [
  'superpowers',
  'superpowers-explorer',
  'superpowers-implementer',
  'superpowers-knowledge',
  'superpowers-designer',
  'superpowers-reviewer',
]);
```

- [ ] **Step 2: Run the full test suite to verify any remaining old IDs fail**

Run: `npm test`
Expected: FAIL if any `autopilot-*` assumptions remain in tests or implementation.

- [ ] **Step 3: Finish the remaining implementation and sync local OpenCode config**

```bash
npm run bootstrap:install
```

Expected config shape in `/home/ricki/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git"
  ],
  "agent": {
    "superpowers": { "mode": "primary", "metadata": { "owner": "autopilot" } },
    "superpowers-explorer": { "mode": "subagent", "metadata": { "owner": "autopilot" } },
    "superpowers-implementer": { "mode": "subagent", "metadata": { "owner": "autopilot" } },
    "superpowers-knowledge": { "mode": "subagent", "metadata": { "owner": "autopilot" } },
    "superpowers-designer": { "mode": "subagent", "metadata": { "owner": "autopilot" } },
    "superpowers-reviewer": { "mode": "subagent", "metadata": { "owner": "autopilot" } }
  },
  "default_agent": "superpowers"
}
```

- [ ] **Step 4: Run the verification commands to confirm code and config are green**

Run: `npm test`
Expected: PASS

Run: `npm run readiness:check`
Expected:

```text
detect-opencode
backup-config
ensure-superpowers
install-autopilot
provision-agents
validate-readiness
ready=true
missing=
```

- [ ] **Step 5: Commit the final integration pass**

```bash
git add src/autopilot-hook.test.ts src/bootstrap.test.ts src/readiness.test.ts
git commit -m "feat: sync native superpowers autopilot install"
```

## Self-Review

- Spec coverage: the approved design requirements are covered by Task 1 (clean IDs), Task 2 (clean config merge), Task 3 (approved spec+plan auto-start), Task 4 (bootstrap readiness), Task 5 (docs/source-of-truth), and Task 6 (real local config sync and end-to-end verification).
- Placeholder scan: no TODO/TBD markers remain; every task has explicit files, commands, and concrete code snippets.
- Type consistency: canonical IDs are consistently `superpowers`, `superpowers-explorer`, `superpowers-implementer`, `superpowers-knowledge`, `superpowers-designer`, `superpowers-reviewer`, and the execution trigger reason remains `artifact-execution` for approved artifact handoff.
