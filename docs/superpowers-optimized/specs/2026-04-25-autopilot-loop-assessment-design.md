# Autopilot Loop Assessment Design

## Scope

Replace the current incorrect idle-loop behavior in the autopilot plugin with an explicit idle assessment step before any continuation prompt is sent. The change applies to the existing loop flow in `src/autopilot-hook.ts` and supporting state in `src/types.ts`, with test updates in `src/autopilot-hook.test.ts`.

## Non-Goals

- No new public command mode or parallel "v2" path.
- No transcript-wide message analysis.
- No durable cross-session persistence.
- No full workflow-phase engine redesign.
- No unrelated parser or README cleanup outside loop handling.

## Architecture And Data Flow

The current flow is `session.idle -> timer -> loop increment -> generic continue prompt`. That flow will be replaced with `session.idle -> assessIdleReason(state, config) -> decide action -> maybe send continuation prompt`.

The new decision layer becomes the only legal path for loop continuation. `handleSessionIdle()` will no longer assume that every idle event means "continue". Instead, it will ask a helper for an `IdleAssessment` result, then either continue, stop for the user, stop because complete, or stop autopilot because it is stalled or over budget.

Loop count remains bounded per session, but it is incremented only when the plugin actually sends a new continuation prompt. Idle detection alone is not counted as a loop.

## Interfaces And Contracts

Add internal decision types in `src/types.ts`:

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
```

Extend `AutopilotState` with minimal loop-decision metadata:

```ts
lastRecommendation: string | null;
canAutoProceed: boolean;
stagnationCount: number;
lastObservedOutcome: 'progress' | 'no_progress' | 'blocked' | 'complete';
lastPromptKind: 'start' | 'continue' | 'stop' | 'resume' | null;
```

Internal helper contract in `src/autopilot-hook.ts`:

- `assessIdleReason(state, config): IdleAssessment`
- `buildContinuationPrompt(state, assessment): string`
- `stopAutopilot(sessionID, state, reasonText): Promise<void>`

`handleSessionIdle()` must route all continuation decisions through `assessIdleReason()`. No direct `idle => continue` behavior remains.

## Decision Rules

Priority order for idle handling:

1. If autopilot is disabled, do nothing.
2. If `currentLoop >= maxLoops`, stop autopilot.
3. If `lastObservedOutcome === 'complete'`, stop as complete.
4. If `stagnationCount` exceeds a small threshold, stop autopilot.
5. If `canAutoProceed` is true and `lastRecommendation` exists, continue with that recommendation.
6. If `lastObservedOutcome === 'blocked'`, treat it as soft-blocked when auto-proceed is still allowed, otherwise hard-blocked.
7. If `currentPhase === 'verify'`, continue with verification.
8. Otherwise use a constrained unknown fallback: continue once with a focused prompt, then stop if the same no-progress condition repeats.

The critical design rule is:

> If the agent goes idle while waiting for a low-risk directional choice and a clear recommendation already exists, autopilot must continue using that recommendation instead of stopping to ask the user.

## Prompt Behavior

Generic continuation text is removed. Continuation prompts are selected from small templates based on the assessment.

If there is a recommendation to follow:

```text
[Autopilot loop X/N]
Task: <task>
Continue using the previous recommendation: <recommendation>.
Do not stop only to ask for low-risk directional confirmation.
Stop only for material ambiguity, a real blocker, or an irreversible decision.
```

If verification is still pending:

```text
[Autopilot loop X/N]
Task: <task>
Implementation is not complete because verification has not run yet.
Run the most direct verification now. If it fails, apply the smallest clear fix and rerun.
```

If the agent is stalled without progress:

```text
[Autopilot loop X/N]
Task: <task>
You paused without clear progress.
Take the next concrete step closest to completion. Do not restart broad exploration.
```

If the plugin stops for a user decision, it should send one short reason and one clear question.

## Error Handling

The plugin should stop instead of repeatedly reprompting when it has evidence that continuation is no longer safe or useful:

- total loop budget exhausted
- repeated no-progress idle cycles
- hard block without safe auto-proceed
- completion already observed

`maxLoopsPerPhase` remains as a secondary guard only. It must not remain the main reason autopilot stops early in the default `design` phase, because the current phase tracking is not rich enough to justify that behavior.

## Testing Strategy

Update `src/autopilot-hook.test.ts` to cover:

1. Idle continuation with `lastRecommendation` and `canAutoProceed=true` sends a recommendation-based prompt and increments the loop.
2. Idle when `lastObservedOutcome='complete'` stops without incrementing the loop.
3. Repeated idle without progress increases `stagnationCount` and eventually stops autopilot.
4. `session.status` with `busy` still cancels pending timers to prevent duplicate prompts.
5. `resume` continues from the prior loop count rather than resetting loop state.

## Rollout Notes

This change intentionally overwrites the current loop semantics. It does not introduce compatibility behavior for the old incorrect `idle => continue` rule. Existing tests that assert the old generic continuation prompt should be updated to assert decision-based continuation instead.

## Failure-Mode Check

### Critical: No transcript-aware understanding

The plugin still cannot truly read the full conversation, so it cannot perfectly infer when the agent asked for direction. The design avoids pretending otherwise by using explicit internal state (`lastRecommendation`, `canAutoProceed`, `lastObservedOutcome`) instead of fake deep inference. This is acceptable for the patch.

### Critical: Unknown fallback could continue too aggressively

If `unknown` always continues, the plugin can still create noisy loops. The design constrains that fallback by coupling it to stagnation counting and stopping after repeated no-progress cycles.

### Minor: Phase loop counting remains imperfect

The plugin still does not implement a full phase engine, so `maxLoopsPerPhase` remains approximate. This is documented as a limitation and downgraded to a secondary guard rather than a primary correctness mechanism.
