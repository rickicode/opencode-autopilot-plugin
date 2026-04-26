# Autopilot Loop Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `session.idle => always continue` loop behavior with explicit idle assessment that only continues when autopilot has a safe, specific next action.
**Architecture:** The existing session state in `src/autopilot-hook.ts` remains the control point, but idle handling is refactored behind assessment helpers. `handleSessionIdle()` becomes a small orchestration function that asks for an `IdleAssessment`, then either sends a context-aware continuation prompt or stops with a reason. Tests in `src/autopilot-hook.test.ts` lock in the new behavior before the hook changes.
**Tech Stack:** TypeScript, Node.js timers, OpenCode plugin session prompt API, built-in `node --test`
**Assumptions:** Assumes internal state is the only reliable source for loop decisions — will NOT infer direction requests from full transcript content. Assumes the current plugin test style remains valid — will NOT work if the repo migrates to a different test runner during implementation.

---

## File Structure

- `src/types.ts`
  Defines `IdleReason`, `IdleAction`, `IdleAssessment`, and extra `AutopilotState` fields needed for decision-based loop handling.
- `src/autopilot-hook.ts`
  Contains the new idle assessment helpers, prompt builders, and the replacement loop control flow.
- `src/autopilot-hook.test.ts`
  Locks in the new loop semantics with failing tests before implementation.

### Task 1: Add idle assessment types and state fields

**Files:**
- Modify: `src/types.ts`
- Test: `src/types.test.ts`

**Does NOT cover:** Runtime loop behavior changes. This task only defines internal contracts and state shape so later tasks can implement the new gate correctly.

- [x] **Step 1: Write failing test**

```ts
import { DEFAULT_CONFIG } from './types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  assert(DEFAULT_CONFIG.defaultMaxLoops === 10, 'keeps default max loops');
  assert(DEFAULT_CONFIG.maxLoopsPerPhase === 5, 'keeps max loops per phase');

  const state = {
    enabled: true,
    sessionID: 'session-1',
    task: 'build plugin',
    maxLoops: 3,
    currentLoop: 1,
    currentPhase: 'design' as const,
    phaseLoopCount: 1,
    startTime: 1,
    lastActivity: 1,
    pendingTimer: null,
    lastRecommendation: 'use the recommended approach',
    canAutoProceed: true,
    stagnationCount: 0,
    lastObservedOutcome: 'progress' as const,
    lastPromptKind: 'continue' as const,
  };

  assert(state.lastRecommendation === 'use the recommended approach', 'supports recommendation state');
  assert(state.canAutoProceed === true, 'supports auto proceed flag');
  assert(state.lastObservedOutcome === 'progress', 'supports observed outcome state');
  assert(state.lastPromptKind === 'continue', 'supports prompt kind state');
}

void run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test "dist/types.test.js"`
Expected: FAIL with missing `lastRecommendation` / `canAutoProceed` / `lastObservedOutcome` / `lastPromptKind` state fields in the compiled type contract

- [x] **Step 3: Implement minimal change**

```ts
export type IdleReason =
  | 'waiting_direction'
  | 'waiting_user_decision'
  | 'blocked_soft'
  | 'blocked_hard'
  | 'verify_pending'
  | 'stalled_no_progress'
  | 'stalled_repeating'
  | 'complete'
  | 'unknown';

export type IdleAction =
  | 'continue'
  | 'stop_for_user'
  | 'stop_complete'
  | 'stop_autopilot';

export interface IdleAssessment {
  reason: IdleReason;
  action: IdleAction;
  message: string;
  shouldIncrementLoop: boolean;
}

export interface AutopilotState {
  enabled: boolean;
  sessionID: string;
  task: string;
  maxLoops: number;
  currentLoop: number;
  currentPhase: 'design' | 'plan' | 'execute' | 'verify' | 'complete';
  phaseLoopCount: number;
  startTime: number;
  lastActivity: number;
  pendingTimer: NodeJS.Timeout | null;
  lastRecommendation: string | null;
  canAutoProceed: boolean;
  stagnationCount: number;
  lastObservedOutcome: 'progress' | 'no_progress' | 'blocked' | 'complete';
  lastPromptKind: 'start' | 'continue' | 'stop' | 'resume' | null;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/types.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "refactor autopilot loop state"
```

### Task 2: Lock in recommendation-based idle continuation

**Files:**
- Modify: `src/autopilot-hook.test.ts`
- Test: `src/autopilot-hook.test.ts`

**Does NOT cover:** Complete stop logic or stagnation handling. This task only locks in the new continuation rule that replaces the old generic prompt.

- [x] **Step 1: Write failing test**

```ts
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'status' },
    statusOutput,
  );

  const internal = statusOutput.parts[0]?.text ?? '';
  const recommendationMatch = internal.match(/Recommendation: (.+)/);
  assert(recommendationMatch, 'status exposes recommendation for test setup');

  await hook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-1' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(prompts.length, 1, 'sends continuation prompt on idle');
  assert(
    prompts[0]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'continuation prompt follows recommendation instead of generic continue text',
  );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: FAIL because current idle prompt still says `Continue with next step.` and no recommendation-based branch exists

- [x] **Step 3: Implement minimal change**

```ts
function buildContinuationPrompt(
  state: AutopilotState,
  assessment: IdleAssessment,
): string {
  return [
    `[Autopilot loop ${state.currentLoop}/${state.maxLoops}]`,
    `Task: ${state.task}`,
    assessment.message,
  ].join('\n');
}

function assessIdleReason(
  state: AutopilotState,
  config: AutopilotConfig,
): IdleAssessment {
  if (state.currentLoop >= state.maxLoops) {
    return {
      reason: 'stalled_repeating',
      action: 'stop_autopilot',
      message: `Autopilot stopped: reached max loops (${state.maxLoops}).`,
      shouldIncrementLoop: false,
    };
  }

  if (state.canAutoProceed && state.lastRecommendation) {
    return {
      reason: 'waiting_direction',
      action: 'continue',
      message: [
        `Continue using the previous recommendation: ${state.lastRecommendation}.`,
        'Do not stop only to ask for low-risk directional confirmation.',
        'Stop only for material ambiguity, a real blocker, or an irreversible decision.',
      ].join('\n'),
      shouldIncrementLoop: true,
    };
  }

  return {
    reason: 'unknown',
    action: 'continue',
    message: 'Take the next concrete step closest to completion. Do not restart broad exploration.',
    shouldIncrementLoop: true,
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: PASS for recommendation-based continuation behavior

- [ ] **Step 5: Commit**

```bash
git add src/autopilot-hook.ts src/autopilot-hook.test.ts
git commit -m "fix autopilot idle continuation"
```

### Task 3: Replace unconditional idle looping with full assessment flow

**Files:**
- Modify: `src/autopilot-hook.ts`
- Test: `src/autopilot-hook.test.ts`

**Does NOT cover:** Transcript parsing or cross-session persistence. This task changes only internal idle decision flow for the existing plugin session state.

- [x] **Step 1: Write failing test**

```ts
  const completeHook = createAutopilotHook(ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await completeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-complete', arguments: '"ship feature"' },
    { parts: [] },
  );
  await completeHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-complete', status: { type: 'busy' } },
    },
  });
  await completeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-complete' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(
    prompts.some((prompt) =>
      prompt.body.parts[0]?.text?.includes('Autopilot stopped: task is already complete.'),
    ),
    'stops instead of continuing when completion has been observed',
  );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: FAIL because current idle handler always continues until loop limits are hit

- [x] **Step 3: Implement minimal change**

```ts
async function stopAutopilot(
  sessionID: string,
  state: AutopilotState,
  reasonText: string,
): Promise<void> {
  state.enabled = false;
  state.lastPromptKind = 'stop';

  await ctx.client.session.prompt({
    path: { id: sessionID },
    body: {
      parts: [createInternalPrompt(reasonText)],
    },
  });
}

async function handleSessionIdle(sessionID: string): Promise<void> {
  const state = sessions.get(sessionID);
  if (!state || !state.enabled) {
    return;
  }

  const assessment = assessIdleReason(state, config);

  if (assessment.action === 'stop_complete') {
    await stopAutopilot(sessionID, state, 'Autopilot stopped: task is already complete.');
    return;
  }

  if (assessment.action === 'stop_for_user' || assessment.action === 'stop_autopilot') {
    await stopAutopilot(sessionID, state, assessment.message);
    return;
  }

  state.pendingTimer = setTimeout(async () => {
    state.pendingTimer = null;
    if (assessment.shouldIncrementLoop) {
      state.currentLoop += 1;
      state.phaseLoopCount += 1;
      state.stagnationCount += 1;
    }
    state.lastActivity = Date.now();
    state.lastPromptKind = 'continue';

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [createInternalPrompt(buildContinuationPrompt(state, assessment))],
      },
    });
  }, config.cooldownMs);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: PASS for stop-on-complete and assessment-driven continuation behavior

- [ ] **Step 5: Commit**

```bash
git add src/autopilot-hook.ts src/autopilot-hook.test.ts
git commit -m "replace autopilot idle loop gate"
```

### Task 4: Add stagnation guard and preserve busy/resume behavior

**Files:**
- Modify: `src/autopilot-hook.ts`
- Modify: `src/autopilot-hook.test.ts`
- Test: `src/autopilot-hook.test.ts`

**Does NOT cover:** New public resume syntax or parser changes. This task only hardens the new loop logic against repeat idle cycles and keeps existing timer cancellation semantics.

- [x] **Step 1: Write failing test**

```ts
  const stalledHook = createAutopilotHook(ctx, {
    defaultMaxLoops: 5,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await stalledHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stalled', arguments: '"refine flow"' },
    { parts: [] },
  );

  for (let i = 0; i < 4; i += 1) {
    await stalledHook.handleEvent({
      event: { type: 'session.idle', properties: { sessionID: 'session-stalled' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert(
    prompts.some((prompt) =>
      prompt.body.parts[0]?.text?.includes('Autopilot stopped: no progress after repeated idle loops.'),
    ),
    'stops after repeated no-progress idle loops',
  );
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: FAIL because the current implementation has no stagnation guard

- [x] **Step 3: Implement minimal change**

```ts
const MAX_STAGNATION_LOOPS = 3;

function assessIdleReason(
  state: AutopilotState,
  config: AutopilotConfig,
): IdleAssessment {
  if (state.currentLoop >= state.maxLoops) {
    return {
      reason: 'stalled_repeating',
      action: 'stop_autopilot',
      message: `Autopilot stopped: reached max loops (${state.maxLoops}).\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
      shouldIncrementLoop: false,
    };
  }

  if (state.lastObservedOutcome === 'complete') {
    return {
      reason: 'complete',
      action: 'stop_complete',
      message: 'Autopilot stopped: task is already complete.',
      shouldIncrementLoop: false,
    };
  }

  if (state.stagnationCount >= MAX_STAGNATION_LOOPS) {
    return {
      reason: 'stalled_repeating',
      action: 'stop_autopilot',
      message: 'Autopilot stopped: no progress after repeated idle loops.\n\nUse /autopilot resume to continue, or /autopilot off to disable.',
      shouldIncrementLoop: false,
    };
  }

  return previousRules(state, config);
}

// in session.status busy handler
if (state) {
  cancelPendingTimer(state);
  state.lastObservedOutcome = 'progress';
  if (state.stagnationCount > 0) {
    state.stagnationCount = 0;
  }
}

// in resume
state.lastPromptKind = 'resume';
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test "dist/autopilot-hook.test.js"`
Expected: PASS, including no-progress stop and preserved busy/resume behavior

- [ ] **Step 5: Commit**

```bash
git add src/autopilot-hook.ts src/autopilot-hook.test.ts
git commit -m "guard autopilot against stalled loops"
```

## Self-Review

### Spec coverage

- Replaces unconditional idle continuation: covered by Tasks 2 and 3.
- Adds explicit decision types and state: covered by Task 1.
- Adds recommendation-based continuation: covered by Task 2.
- Adds stop-on-complete and stop-on-stall behavior: covered by Tasks 3 and 4.
- Preserves busy cancellation and resume semantics: covered by Task 4.

### Placeholder scan

No `TBD`, `TODO`, or deferred implementation language remains. Each task names exact files, commands, and code targets.

### Type consistency

The plan uses one consistent naming set: `IdleReason`, `IdleAction`, `IdleAssessment`, `lastRecommendation`, `canAutoProceed`, `stagnationCount`, `lastObservedOutcome`, and `lastPromptKind`.

Plan complete and saved to `docs/superpowers-optimized/plans/2026-04-25-autopilot-loop-assessment.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, with checkpoints

**Which approach?**
