# Autopilot Superpowers

## Purpose

This repository should produce an autopilot wrapper for Superpowers.

The goal is not to replace `obra/superpowers`.
The goal is to let execution run autonomously after spec and plan already exist, so the user does not need to keep replying `continue`, `lanjut`, or other babysitting prompts for every task.

Success means:

- Superpowers remains the source of workflow and skills.
- This plugin takes over at execute stage.
- The wrapper runs the full plan until finished.
- The wrapper stops only for real blockers, ambiguity outside the approved spec/plan, irreversible decisions, or failed verification that truly needs a human.
- Completion is claimed only after verification evidence exists.

## Product Contract

This plugin is an execute-stage wrapper.

It should behave like this:

1. User or Superpowers creates a spec.
2. User or Superpowers creates a plan.
3. Autopilot detects execute-ready state.
4. Autopilot runs plan tasks one by one without asking the user to continue at every step.
5. Each task goes through implement and verify flow.
6. When all tasks are done, autopilot enters finish flow.
7. Autopilot stops only at legitimate stop gates.

Non-goal:

- This plugin should not become a second design/planning framework separate from Superpowers.

## Upstream Superpowers Analysis

Repository analyzed: `https://github.com/obra/superpowers`

Key findings from upstream:

- Superpowers is primarily a workflow and skill system, not an idle-loop autopilot engine.
- OpenCode integration installs the original plugin string: `superpowers@git+https://github.com/obra/superpowers.git`.
- The upstream plugin mainly injects bootstrap/system context and registers the skills directory so the host can discover all skills.
- Upstream workflow is strict: use the relevant skill before acting, do design before implementation, do planning after approved design, execute via subagent-driven development, and verify before claiming completion.

Important upstream workflow behavior:

1. `using-superpowers` is the routing/entry discipline.
2. `brainstorming` gates design before code.
3. `writing-plans` turns approved design into executable steps.
4. `subagent-driven-development` executes plan tasks.
5. `verification-before-completion` requires fresh evidence before saying work is done.

Implication:

- Upstream Superpowers provides methodology.
- This repo should provide autonomous execution control on top of that methodology.

## Current Local Plugin Behavior

The current plugin already has a useful control loop.

Main mechanics:

- `/autopilot` commands are parsed in `src/utils.ts`.
- `createAutopilotHook()` in `src/autopilot-hook.ts` stores per-session state such as enabled flag, task, loop counters, phase labels, timers, and recommendation-related state.
- Startup prompt injects Superpowers-oriented instructions.
- On `session.idle`, the hook decides whether to continue and may inject a continuation prompt.
- Stop gates already exist for max loops, stagnation, some blocked/error paths, and merge/branch decision boundaries.
- Install/bootstrap/readiness checks exist in `src/bootstrap.ts`, `src/config-merge.ts`, and `src/readiness.ts`.

Strengths today:

- The state machine is fairly solid.
- Session-local anti-race handling already exists.
- Timer cancellation and resume flow are present.
- Tests cover important loop behavior.

## Current Gaps

The biggest gap is not low-level looping.
The biggest gap is contract alignment with the intended execute-stage wrapper behavior.

### 1. Runtime role mismatch

Canonical managed roles already point toward this taxonomy:

- `superpowers`
- `explorer`
- `implementer`
- `knowledge`
- `designer`
- `reviewer`

But runtime subagents in `src/subagents.ts` still use a custom toolkit shape with names like:

- `librarian`
- `oracle`
- `fixer`
- `observer`

This weakens the execution contract because the wrapper is not aligned with the upstream role model it claims to wrap.

### 2. Prompt-driven execution instead of artifact-driven execution

Current behavior is still mostly:

- detect context
- inject guidance
- continue on idle

That is useful, but it is not enough for a true execute-stage wrapper.

The wrapper should derive execution state from actual artifacts and task progress, not just continue because the session went idle.

### 3. No plan task engine yet

The plugin reads Superpowers docs/spec/plan context, but it does not yet treat the plan as a structured task list with:

- current task
- pending tasks
- completed tasks
- blocked task
- verification gate per task

Without that, the wrapper still behaves like a continuation loop rather than a task executor.

### 4. Readiness is only partially separated

The repo has install/readiness logic, but it should explicitly separate:

- installation readiness
- execution readiness

Install readiness means plugin/config/agent prerequisites exist.
Execution readiness means an approved spec and actionable plan exist and the wrapper can safely enter execute mode.

### 5. Stop policy is not strict enough yet

Today the plugin has stop conditions, but the ideal policy should classify stop reasons explicitly and only stop for legitimate categories.

Target categories:

- `hard-blocker`
- `spec-ambiguity`
- `irreversible-decision`
- `verification-failed`
- `environment-not-ready`

## File-By-File Assessment

### `src/bootstrap.ts`

Good at install readiness and plugin/config validation.

Gap:

- does not yet define execute-readiness as a separate contract.

### `src/config-merge.ts`

Good at ensuring the original Superpowers plugin is declared and managed agent config exists.

Gap:

- config presence does not guarantee runtime execution behavior matches the intended wrapper model.

### `src/agent-manifest.ts`

Good canonical contract for managed roles.

Gap:

- runtime agent behavior still does not fully match the manifest.

### `src/subagents.ts`

Current custom toolkit is the largest architectural mismatch.

Gap:

- should be normalized around the canonical execute roles.
- optional helpers should not define the core execution contract.

### `src/readiness.ts`

Directionally good.

Gap:

- uses artifacts mainly as triggers, not as hard execution-contract evidence.

### `src/utils.ts`

Good for command parsing and prompt assembly.

Gap:

- lacks structured plan understanding and active-task modeling.

### `src/autopilot-hook.ts`

Strongest file in the repo today.

Good:

- loop state
- anti-race logic
- continuation plumbing
- stop gates

Gap:

- phase labels are not yet proof-backed workflow phases.
- continuation is still recommendation/idle driven, not task-graph driven.
- there is no plan completion engine.
- finish detection is still weaker than it should be.

### `src/index.ts`

Good plugin wiring.

Gap:

- should expose a cleaner canonical execute-wrapper model rather than a custom runtime shape.

## Target Architecture

### Core principle

Superpowers owns methodology.
Autopilot owns hands-free execution after design and planning are already ready.

### Responsibility boundary

Upstream Superpowers owns:

- `using-superpowers`
- `brainstorming`
- `writing-plans`
- `test-driven-development`
- `verification-before-completion`
- `finishing-a-development-branch`
- the overall skills library

Autopilot wrapper owns:

- detect execute-ready state
- load the active spec and plan
- derive execution state from the plan
- move task-to-task automatically
- suppress unnecessary continue prompts
- stop only when legitimate stop gates are hit

### Target lifecycle

1. `idle`
2. `design`
3. `plan`
4. `execute`
5. `verify`
6. `finish`
7. `blocked`
8. `done`

Meaning:

- `idle`: no active execution contract
- `design`: spec/design still being formed or approved
- `plan`: implementation plan still being formed or approved
- `execute`: active task execution from an approved plan
- `verify`: task or whole-run verification gate is active
- `finish`: all planned tasks are done and branch/result workflow remains
- `blocked`: execution stopped for a valid stop reason
- `done`: verified completion reached

### Target execution state

Suggested internal shape:

```ts
interface ExecutionState {
  activeSpecPath: string | null;
  activePlanPath: string | null;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  pendingTaskIds: string[];
  completedTaskIds: string[];
  blockedTaskId: string | null;
  verificationPending: boolean;
  finishReady: boolean;
  lastVerifiedAt: number | null;
}
```

### Target runtime roles

Core runtime roles should be:

- `superpowers`
- `explorer`
- `implementer`
- `knowledge`
- `designer`
- `reviewer`

Optional helper roles may exist, but they should not define the main contract.

### Target execution routing

Ideal routing per task:

1. `superpowers` selects current task.
2. `knowledge` loads relevant spec/plan context.
3. `explorer` locates files and code paths.
4. `implementer` performs the change.
5. `reviewer` checks spec compliance, quality, and readiness.
6. Wrapper marks the task complete and advances automatically.

### Target prompt shape

Prompts should reflect real execution state, for example:

```text
[Autopilot execute 3/7]
Spec: docs/superpowers/specs/...
Plan: docs/superpowers/plans/...
Current task: Implement readiness split
Completed tasks: 2
Next gate: reviewer verification
```

This is better than generic continuation text because it ties the loop to actual task state.

### Target readiness split

Installation readiness:

- config readable
- original Superpowers plugin declared
- autopilot plugin available
- canonical agents available

Execution readiness:

- active spec exists
- active plan exists
- plan can be parsed into executable tasks
- no approval is still pending

### Target plan parsing

Add a minimal parser that can derive tasks from markdown plans.

Suggested model:

```ts
interface ParsedPlanTask {
  id: string;
  title: string;
  body: string;
  verification: string[];
  status: 'pending' | 'in_progress' | 'completed';
}
```

The parser does not need to be fancy.
It only needs to be reliable enough to turn approved plans into a task list the wrapper can drive.

## Repair Roadmap

### Stage 1: Normalize terminology and paths

- remove leftover legacy path terminology
- keep artifact naming focused on `docs/superpowers/...`
- standardize artifact paths to `docs/superpowers/specs` and `docs/superpowers/plans`
- keep one clear product document as the source of truth

### Stage 2: Align runtime taxonomy

- make runtime roles match the canonical manifest
- reduce or remove custom role names from the core execution contract
- ensure prompts and tests use the same role model

### Stage 3: Add execution readiness

- distinguish install readiness from execute readiness
- do not start true execute mode until spec and plan are both present and actionable

### Stage 4: Add plan parser and task state

- parse plan markdown into structured tasks
- store active task state in autopilot session state
- advance task-to-task automatically

### Stage 5: Make continuation task-driven

- continuation should be based on active task state, not only idle/recommendation state
- prompts should name the current task and next verification gate

### Stage 6: Harden stop policy

- classify stop reasons explicitly
- stop only for approved blocker categories
- avoid noisy user confirmations for low-risk next steps

### Stage 7: Strengthen finish contract

- detect when all tasks are complete
- require verification evidence before claiming done
- hand off branch/merge/PR outcome only at the real finish boundary

## Source Of Truth Rules

When repairing this repo, prefer these rules:

1. Do not redesign Superpowers itself.
2. Do not add a second planning methodology here.
3. Treat spec and plan as the execution contract.
4. Prefer wrapper enforcement over prompt hope.
5. Prefer canonical runtime roles over custom names.
6. Prefer task-state execution over generic idle looping.
7. Prefer real verification evidence over optimistic completion.

## Immediate Cleanup Decisions Already Chosen

These decisions are already settled and should stay consistent:

- primary runtime agent name is `superpowers`
- managed primary agent ID is `superpowers`
- managed subagent IDs are `superpowers-explorer`, `superpowers-implementer`, `superpowers-knowledge`, `superpowers-designer`, and `superpowers-reviewer`
- approved spec and plan artifacts gate execution handoff into autopilot
- original upstream plugin dependency is `superpowers@git+https://github.com/obra/superpowers.git`
- artifact path terminology should use `docs/superpowers/...`
- this file is the single source of truth for the repair direction unless a newer document explicitly replaces it
