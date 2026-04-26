import type { PluginInput } from '@opencode-ai/plugin';
import { createAutopilotHook, createAutopilotHookForTest } from './autopilot-hook';
import type { CommandOutput, CommandTextPart } from './types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
    );
  }
}

async function run(): Promise<void> {
  function createPromptCollector(): {
    prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }>;
    ctx: PluginInput;
  } {
    const prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }> = [];

    const ctx = {
      client: {
        session: {
          prompt: async (input: {
            path: { id: string };
            body: { parts: CommandTextPart[] };
          }) => {
            prompts.push(input);
          },
        },
      },
    } as PluginInput;

    return { prompts, ctx };
  }

  function createDeferredPromptCollector(): {
    prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }>;
    pendingPrompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
      resolve: () => void;
    }>;
    resolveNextPrompt: () => void;
    ctx: PluginInput;
  } {
    const prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }> = [];
    const pendingPrompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
      resolve: () => void;
    }> = [];

    const ctx = {
      client: {
        session: {
          prompt: async (input: {
            path: { id: string };
            body: { parts: CommandTextPart[] };
          }) =>
            new Promise<void>((resolve) => {
              pendingPrompts.push({
                ...input,
                resolve: () => {
                  prompts.push(input);
                  resolve();
                },
              });
            }),
        },
      },
    } as PluginInput;

    return {
      prompts,
      pendingPrompts,
      resolveNextPrompt: () => {
        const nextPrompt = pendingPrompts.shift();
        if (!nextPrompt) {
          throw new Error('Expected a pending prompt to resolve');
        }
        nextPrompt.resolve();
      },
      ctx,
    };
  }

  function createFlakyPromptCollector(): {
    prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }>;
    attempts: number;
    ctx: PluginInput;
  } {
    const prompts: Array<{
      path: { id: string };
      body: { parts: CommandTextPart[] };
    }> = [];
    let attempts = 0;

    const ctx = {
      client: {
        session: {
          prompt: async (input: {
            path: { id: string };
            body: { parts: CommandTextPart[] };
          }) => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error('prompt failed');
            }
            prompts.push(input);
          },
        },
      },
    } as PluginInput;

    return {
      prompts,
      get attempts() {
        return attempts;
      },
      ctx,
    };
  }

  const primaryScenario = createPromptCollector();
  const prompts = primaryScenario.prompts;
  const ctx = primaryScenario.ctx;

  const hook = createAutopilotHook(ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });

  const nonAutopilotOutput: CommandOutput = {
    parts: [{ type: 'text', text: 'keep me' }],
  };
  await hook.handleCommandExecuteBefore(
    { command: 'other', sessionID: 'session-1', arguments: '' },
    nonAutopilotOutput,
  );
  assertEqual(nonAutopilotOutput.parts, [{ type: 'text', text: 'keep me' }], 'ignores other commands');

  const startOutput: CommandOutput = { parts: [] };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: '"build plugin"' },
    startOutput,
  );
  assert(startOutput.parts[0]?.text?.includes('Autopilot enabled: build plugin'), 'starts autopilot');
  assert(
    startOutput.parts[0]?.text?.includes('You are the orchestrator for a superpowers-governed workflow.'),
    'startup prompt uses orchestrator identity',
  );
  assert(
    startOutput.parts[0]?.text?.includes('Prefer slim-style specialists before built-in fallbacks.'),
    'startup prompt prefers slim-style specialists',
  );
  assert(
    startOutput.parts[0]?.text?.includes('Do not default to inline implementation when delegation is available.'),
    'startup prompt forbids inline-first execution',
  );

  const statusOutput: CommandOutput = { parts: [] };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'status' },
    statusOutput,
  );
  assertEqual(
    statusOutput.parts[0]?.text,
    [
      '[AUTOPILOT-INTERNAL]',
      'Autopilot: enabled',
      'Task: build plugin',
      'Progress: 0/3 loops',
      'Phase: design (0 loops in phase)',
      'Recommendation: Continue advancing the current phase for: build plugin',
    ].join('\n'),
    'reports enabled status',
  );

  const recommendationMatch = statusOutput.parts[0]?.text?.match(/Recommendation: (.+)/);
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
  assert(
    prompts[0]?.body.parts[0]?.text?.includes('Continue as orchestrator.'),
    'continuation prompt reinforces orchestrator role',
  );
  assert(
    prompts[0]?.body.parts[0]?.text?.includes('Check whether the next step should be delegated before doing work inline.'),
    'continuation prompt reinforces delegation-first behavior',
  );

  await hook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    },
  });

  await hook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-1' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(prompts.length, 2, 'sends second continuation prompt on later idle');
  assert(
    prompts[1]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'restores recommendation-based continuation after normal progress/busy before the next eligible idle',
  );

  const resumedStatusOutput: CommandOutput = { parts: [] };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'status' },
    resumedStatusOutput,
  );
  assert(
    resumedStatusOutput.parts[0]?.text?.includes('Progress: 2/3 loops'),
    'idle continuation increments loop count',
  );

  const offOutput: CommandOutput = { parts: [] };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'off' },
    offOutput,
  );
  assertEqual(
    offOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nAutopilot disabled.',
    'disables autopilot',
  );

  const resumeMissingOutput: CommandOutput = { parts: [] };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-2', arguments: 'resume' },
    resumeMissingOutput,
  );
  assertEqual(
    resumeMissingOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nNo previous autopilot session to resume.',
    'rejects resume without prior task',
  );

  const limitedScenario = createPromptCollector();
  const limitedPrompts = limitedScenario.prompts;
  const limitedHook = createAutopilotHook(limitedScenario.ctx, {
    defaultMaxLoops: 1,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  const limitedStartOutput: CommandOutput = { parts: [] };
  await limitedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-3', arguments: '"ship feature"' },
    limitedStartOutput,
  );
  await limitedHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-3' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await limitedHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-3' } },
  });

  assertEqual(limitedPrompts.length, 2, 'sends stop prompt after max loops');
  assert(
    limitedPrompts[1]?.body.parts[0]?.text?.includes('Autopilot stopped: reached max loops (1).'),
    'stops when max loops reached',
  );

  const completeScenario = createPromptCollector();
  const completePrompts = completeScenario.prompts;
  const completeHook = createAutopilotHook(completeScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopBeforeMerge: false,
  });
  await completeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-complete', arguments: '"ship feature"' },
    { parts: [] },
  );
  await completeHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-complete', status: { type: 'complete' } },
    },
  });
  await completeHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-complete', status: { type: 'idle' } },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(completePrompts.length, 1, 'continues complete sessions when stopBeforeMerge is disabled');
  assert(
    completePrompts[0]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'continues instead of stopping when completion has been observed and stopBeforeMerge is disabled',
  );

  const userDecisionScenario = createPromptCollector();
  const userDecisionPrompts = userDecisionScenario.prompts;
  const userDecisionHook = createAutopilotHook(userDecisionScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopBeforeMerge: true,
  });
  await userDecisionHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-user-decision', arguments: '"ship feature"' },
    { parts: [] },
  );
  await userDecisionHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-user-decision', status: { type: 'complete' } },
    },
  });
  await userDecisionHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-user-decision' } },
  });

  assertEqual(userDecisionPrompts.length, 1, 'stops for user decision instead of continuing');
  assert(
    userDecisionPrompts[0]?.body.parts[0]?.text?.includes(
      'Autopilot stopped: task is complete and ready for user decision before merge or PR.',
    ),
    'stops for user decision before merge or PR',
  );

  const resumedWorkScenario = createPromptCollector();
  const resumedWorkPrompts = resumedWorkScenario.prompts;
  const resumedWorkHook = createAutopilotHook(resumedWorkScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopBeforeMerge: true,
  });
  await resumedWorkHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resumed-work', arguments: '"ship feature"' },
    { parts: [] },
  );
  await resumedWorkHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-resumed-work', status: { type: 'complete' } },
    },
  });
  await resumedWorkHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-resumed-work', status: { type: 'busy' } },
    },
  });
  await resumedWorkHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-resumed-work' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(resumedWorkPrompts.length, 1, 'busy after complete allows autopilot to continue again');
  assert(
    resumedWorkPrompts[0]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'busy clears the complete-phase stop branch before the next idle cycle',
  );

  const timerScenario = createPromptCollector();
  const timerPrompts = timerScenario.prompts;
  const timerHook = createAutopilotHook(timerScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 25,
  });
  await timerHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-timer', arguments: '"build plugin"' },
    { parts: [] },
  );
  await timerHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-timer' } },
  });
  await timerHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-timer' } },
  });
  await timerHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-timer', status: { type: 'busy' } },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assertEqual(timerPrompts.length, 0, 'busy cancels the only pending continuation prompt');

  const timerStatusOutput: CommandOutput = { parts: [] };
  await timerHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-timer', arguments: 'status' },
    timerStatusOutput,
  );
  assert(
    timerStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops'),
    'duplicate idle events do not double-increment while timer is pending',
  );

  const offRaceScenario = createPromptCollector();
  const offRacePrompts = offRaceScenario.prompts;
  const offRaceHook = createAutopilotHook(offRaceScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await offRaceHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-off-race', arguments: '"build plugin"' },
    { parts: [] },
  );
  await offRaceHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-off-race' } },
  });
  await offRaceHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-off-race', arguments: 'off' },
    { parts: [] },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(offRacePrompts.length, 0, 'stale timer does not prompt after autopilot is turned off');

  const startRaceScenario = createPromptCollector();
  const startRacePrompts = startRaceScenario.prompts;
  const startRaceHook = createAutopilotHook(startRaceScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 10,
  });
  await startRaceHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-start-race', arguments: '"first task"' },
    { parts: [] },
  );
  await startRaceHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-start-race' } },
  });
  await startRaceHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-start-race', arguments: '"second task"' },
    { parts: [] },
  );
  await new Promise((resolve) => setTimeout(resolve, 25));

  assertEqual(startRacePrompts.length, 0, 'starting a new task cancels any pending timer from the previous run');

  const startRaceStatusOutput: CommandOutput = { parts: [] };
  await startRaceHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-start-race', arguments: 'status' },
    startRaceStatusOutput,
  );
  assert(
    startRaceStatusOutput.parts[0]?.text?.includes('Task: second task') &&
      startRaceStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops'),
    'new task starts with a clean loop state after canceling stale timers',
  );

  const resumeScenario = createPromptCollector();
  const resumePrompts = resumeScenario.prompts;
  const resumeHook = createAutopilotHook(resumeScenario.ctx, {
    defaultMaxLoops: 1,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await resumeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume', arguments: '"resume test"' },
    { parts: [] },
  );
  await resumeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-resume' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await resumeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-resume' } },
  });
  const resumeOutput: CommandOutput = { parts: [] };
  await resumeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume', arguments: 'resume' },
    resumeOutput,
  );
  await resumeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-resume' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(
    resumeOutput.parts[0]?.text?.includes('Autopilot resumed: resume test'),
    'resume reports continuation after a loop-limit stop',
  );
  assertEqual(resumePrompts.length, 3, 'resume allows a new continuation after max-loop stop');
  assert(
    resumePrompts[2]?.body.parts[0]?.text?.includes('[Autopilot loop 2/2]'),
    'resume extends loop budget enough to continue once more',
  );

  const stalledScenario = createPromptCollector();
  const stalledPrompts = stalledScenario.prompts;
  const stalledHook = createAutopilotHook(stalledScenario.ctx, {
    defaultMaxLoops: 5,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await stalledHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stalled', arguments: '"refine flow"' },
    { parts: [] },
  );
  await stalledHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-stalled', status: { type: 'busy' } },
    },
  });

  for (let i = 0; i < 4; i += 1) {
    await stalledHook.handleEvent({
      event: { type: 'session.idle', properties: { sessionID: 'session-stalled' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert(
    stalledPrompts.some((prompt) =>
      prompt.body.parts[0]?.text?.includes(
        'Autopilot stopped: no progress after repeated idle loops.',
      ),
    ),
    'stops after repeated no-progress idle loops',
  );

  const stalledResumeOutput: CommandOutput = { parts: [] };
  await stalledHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stalled', arguments: 'resume' },
    stalledResumeOutput,
  );
  await stalledHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-stalled', status: { type: 'busy' } },
    },
  });
  await stalledHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stalled' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(
    stalledResumeOutput.parts[0]?.text?.includes('Autopilot resumed: refine flow'),
    'resume still works after a stagnation stop',
  );
  assert(
    stalledPrompts[stalledPrompts.length - 1]?.body.parts[0]?.text?.includes(
      'Continue using the previous recommendation:',
    ),
    'busy after stagnation resets enough state for continuation to resume',
  );

  const errorStopScenario = createPromptCollector();
  const errorStopPrompts = errorStopScenario.prompts;
  const errorStopHook = createAutopilotHook(errorStopScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopOnError: true,
  });
  await errorStopHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-error-stop', arguments: '"verify release"' },
    { parts: [] },
  );
  await errorStopHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-error-stop', status: { type: 'error' } },
    },
  });
  await errorStopHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-error-stop' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(errorStopPrompts.length, 1, 'error status stops autopilot when stopOnError is enabled');
  assert(
    errorStopPrompts[0]?.body.parts[0]?.text?.includes(
      'Autopilot stopped: verification failed or a critical error occurred.',
    ),
    'error status emits the configured stop-on-error message',
  );

  const errorContinueScenario = createPromptCollector();
  const errorContinuePrompts = errorContinueScenario.prompts;
  const errorContinueHook = createAutopilotHook(errorContinueScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopOnError: false,
  });
  await errorContinueHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-error-continue', arguments: '"verify release"' },
    { parts: [] },
  );
  await errorContinueHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-error-continue', status: { type: 'error' } },
    },
  });
  await errorContinueHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-error-continue' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(errorContinuePrompts.length, 1, 'error status does not force-stop when stopOnError is disabled');
  assert(
    errorContinuePrompts[0]?.body.parts[0]?.text?.includes('Last observed outcome was blocked or errored.'),
    'error status uses a safer blocked/error continuation prompt when stopOnError is disabled',
  );
  assert(
    !errorContinuePrompts[0]?.body.parts[0]?.text?.includes('Recommended next step: Continue advancing the current phase for: verify release'),
    'blocked/error continuation suppresses the stale generic recommendation',
  );
  assert(
    errorContinuePrompts[0]?.body.parts[0]?.text?.includes('Reassess the blocker, verify whether it is resolved, and only continue if the next step is safe and justified.'),
    'error continuation prompt asks for reassessment instead of silently resuming normal flow',
  );

  await errorContinueHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-error-continue' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(errorContinuePrompts.length, 2, 'blocked continuation repeats across idle cycles when no progress intervenes');
  assert(
    errorContinuePrompts[1]?.body.parts[0]?.text?.includes('Last observed outcome was blocked or errored.'),
    'repeated idle after blocked/error keeps the blocked reassessment prompt instead of degrading to generic no-progress guidance',
  );

  await errorContinueHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-error-continue' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(
    errorContinuePrompts.length,
    3,
    'blocked/error reassessment persists even after repeated idle cycles with no progress',
  );
  assert(
    errorContinuePrompts[2]?.body.parts[0]?.text?.includes('Last observed outcome was blocked or errored.'),
    'stagnation handling does not override blocked/error persistence when stopOnError is disabled',
  );

  const staleStartScenario = createDeferredPromptCollector();
  const staleStartPrompts = staleStartScenario.prompts;
  const staleStartHook = createAutopilotHook(staleStartScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await staleStartHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-start', arguments: '"first task"' },
    { parts: [] },
  );
  await staleStartHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-start' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(staleStartScenario.pendingPrompts.length, 1, 'first run has one in-flight continuation prompt');

  await staleStartHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-start', arguments: '"second task"' },
    { parts: [] },
  );

  staleStartScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleStartStatusOutput: CommandOutput = { parts: [] };
  await staleStartHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-start', arguments: 'status' },
    staleStartStatusOutput,
  );
  assert(
    staleStartStatusOutput.parts[0]?.text?.includes('Task: second task') &&
      staleStartStatusOutput.parts[0]?.text?.includes('Recommendation: Continue advancing the current phase for: second task'),
    'resolving a stale prompt does not strip the recommendation from a newer start',
  );
  assert(
    staleStartStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops'),
    'resolving a stale start prompt does not mutate loop counters for the newer run',
  );

  await staleStartHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-start' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(staleStartScenario.pendingPrompts.length, 1, 'new run still schedules its own continuation prompt after stale prompt resolves');

  staleStartScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(staleStartPrompts.length, 2, 'records both the stale and current prompts for inspection');
  assert(
    staleStartPrompts[1]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'new run still uses recommendation-based continuation after stale prompt resolution',
  );

  const staleOffScenario = createDeferredPromptCollector();
  const staleOffPrompts = staleOffScenario.prompts;
  const staleOffHook = createAutopilotHook(staleOffScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await staleOffHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-off', arguments: '"first task"' },
    { parts: [] },
  );
  await staleOffHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-off' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(staleOffScenario.pendingPrompts.length, 1, 'off-race scenario has one in-flight continuation prompt');

  await staleOffHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-off', arguments: 'off' },
    { parts: [] },
  );

  staleOffScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleOffStatusOutput: CommandOutput = { parts: [] };
  await staleOffHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-off', arguments: 'status' },
    staleOffStatusOutput,
  );
  assert(
    staleOffStatusOutput.parts[0]?.text?.includes('Autopilot: disabled'),
    'resolving a stale prompt after off does not re-enable autopilot',
  );

  await staleOffHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-off' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(staleOffPrompts.length, 1, 'no additional stale prompt is emitted after autopilot is turned off');

  const staleResumeScenario = createDeferredPromptCollector();
  const staleResumeHook = createAutopilotHook(staleResumeScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 10,
  });
  await staleResumeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-resume', arguments: '"resume task"' },
    { parts: [] },
  );
  await staleResumeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-resume' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assertEqual(
    staleResumeScenario.pendingPrompts.length,
    1,
    'resume race setup creates one in-flight continuation prompt',
  );

  const staleResumeOutput: CommandOutput = { parts: [] };
  await staleResumeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-resume', arguments: 'resume' },
    staleResumeOutput,
  );
  staleResumeScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleResumeStatusOutput: CommandOutput = { parts: [] };
  await staleResumeHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-resume', arguments: 'status' },
    staleResumeStatusOutput,
  );
  assert(
    staleResumeOutput.parts[0]?.text?.includes('Autopilot resumed: resume task'),
    'resume succeeds while an earlier prompt is still in flight',
  );
  assert(
    staleResumeStatusOutput.parts[0]?.text?.includes('Autopilot: enabled') &&
      staleResumeStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops'),
    'resolving a stale pre-resume prompt does not mutate counters or disable the resumed run',
  );

  await staleResumeHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-resume' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assertEqual(
    staleResumeScenario.pendingPrompts.length,
    1,
    'resumed run schedules only its own new continuation prompt after stale prompt resolution',
  );

  const overlapScenario = createDeferredPromptCollector();
  const overlapHook = createAutopilotHook(overlapScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await overlapHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-overlap', arguments: '"overlap task"' },
    { parts: [] },
  );
  await overlapHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-overlap' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    overlapScenario.pendingPrompts.length,
    1,
    'first idle creates one unresolved continuation prompt',
  );
  await overlapHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-overlap' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    overlapScenario.pendingPrompts.length,
    1,
    'idle does not schedule a second overlapping prompt while the first remains unresolved',
  );

  const stalePendingTimerScenario = createDeferredPromptCollector();
  const stalePendingTimerHook = createAutopilotHook(stalePendingTimerScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await stalePendingTimerHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-pending-timer', arguments: '"first task"' },
    { parts: [] },
  );
  await stalePendingTimerHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-pending-timer' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    stalePendingTimerScenario.pendingPrompts.length,
    1,
    'first run creates one unresolved continuation prompt',
  );

  await stalePendingTimerHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-pending-timer', arguments: '"second task"' },
    { parts: [] },
  );
  await stalePendingTimerHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-pending-timer' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    stalePendingTimerScenario.pendingPrompts.length,
    2,
    'new run schedules its own unresolved continuation prompt',
  );

  stalePendingTimerScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  await stalePendingTimerHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-pending-timer' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    stalePendingTimerScenario.pendingPrompts.length,
    1,
    'stale callback resolution must not clear the newer run pending timer while its prompt is still unresolved',
  );

  const staleBusyScenario = createDeferredPromptCollector();
  const staleBusyHook = createAutopilotHook(staleBusyScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  await staleBusyHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-busy', arguments: '"busy race"' },
    { parts: [] },
  );
  await staleBusyHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-busy' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(staleBusyScenario.pendingPrompts.length, 1, 'busy-race setup creates one unresolved continuation prompt');

  await staleBusyHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-stale-busy', status: { type: 'busy' } },
    },
  });
  staleBusyScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleBusyStatusOutput: CommandOutput = { parts: [] };
  await staleBusyHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-busy', arguments: 'status' },
    staleBusyStatusOutput,
  );
  assert(
    staleBusyStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops') &&
      staleBusyStatusOutput.parts[0]?.text?.includes('Phase: design (0 loops in phase)') &&
      staleBusyStatusOutput.parts[0]?.text?.includes('Recommendation: Continue advancing the current phase for: busy race'),
    'resolving a stale prompt after busy does not mutate counters, phase state, or recommendation',
  );

  const staleCompleteScenario = createDeferredPromptCollector();
  const staleCompleteHook = createAutopilotHook(staleCompleteScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
    stopBeforeMerge: false,
  });
  await staleCompleteHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-complete', arguments: '"complete race"' },
    { parts: [] },
  );
  await staleCompleteHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-complete' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    staleCompleteScenario.pendingPrompts.length,
    1,
    'complete-race setup creates one unresolved continuation prompt',
  );

  await staleCompleteHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-stale-complete', status: { type: 'complete' } },
    },
  });
  staleCompleteScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleCompleteStatusOutput: CommandOutput = { parts: [] };
  await staleCompleteHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-complete', arguments: 'status' },
    staleCompleteStatusOutput,
  );
  assert(
    staleCompleteStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops') &&
      staleCompleteStatusOutput.parts[0]?.text?.includes('Phase: complete (0 loops in phase)'),
    'resolving a stale prompt after complete does not mutate counters or revert the completion phase',
  );

  const staleErrorScenario = createDeferredPromptCollector();
  const staleErrorHook = createAutopilotHook(staleErrorScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
    stopOnError: false,
  });
  await staleErrorHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-error', arguments: '"error race"' },
    { parts: [] },
  );
  await staleErrorHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-stale-error' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(staleErrorScenario.pendingPrompts.length, 1, 'error-race setup creates one unresolved continuation prompt');

  await staleErrorHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-stale-error', status: { type: 'error' } },
    },
  });
  staleErrorScenario.resolveNextPrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const staleErrorStatusOutput: CommandOutput = { parts: [] };
  await staleErrorHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-stale-error', arguments: 'status' },
    staleErrorStatusOutput,
  );
  assert(
    staleErrorStatusOutput.parts[0]?.text?.includes('Progress: 0/3 loops') &&
      staleErrorStatusOutput.parts[0]?.text?.includes('Phase: design (0 loops in phase)') &&
      staleErrorStatusOutput.parts[0]?.text?.includes('Recommendation: Continue advancing the current phase for: error race'),
    'resolving a stale prompt after error does not mutate counters or clear recommendation state',
  );

  const startInstructionScenario = createPromptCollector();
  const startInstructionHook = createAutopilotHook(startInstructionScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
    stopOnError: false,
    stopBeforeMerge: false,
  });
  const startInstructionOutput: CommandOutput = { parts: [] };
  await startInstructionHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-start-instructions', arguments: '"doc task"' },
    startInstructionOutput,
  );
  assert(
    startInstructionOutput.parts[0]?.text?.includes('Execute: implementer BLOCKED, verification FAILED only if stopOnError=true'),
    'startup instructions reflect stopOnError configuration',
  );
  assert(
    startInstructionOutput.parts[0]?.text?.includes('Complete: auto-proceed after verification; stopBeforeMerge=false'),
    'startup instructions reflect stopBeforeMerge configuration',
  );
  assert(
    !startInstructionOutput.parts[0]?.text?.includes(
      ['Stop and ask for user input only when:', '- Complete: auto-proceed after verification; stopBeforeMerge=false'].join('\n'),
    ),
    'non-stop completion guidance does not appear as a stop-condition bullet',
  );

  const failedPromptScenario = createFlakyPromptCollector();
  const failedPromptHook = createAutopilotHook(failedPromptScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await failedPromptHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-failed-prompt', arguments: '"recover prompt"' },
    { parts: [] },
  );
  await failedPromptHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-failed-prompt' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await failedPromptHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-failed-prompt' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(
    failedPromptScenario.attempts,
    2,
    'failed prompt send clears pending timer so a later idle can retry',
  );
  assertEqual(
    failedPromptScenario.prompts.length,
    1,
    'later idle recovers and successfully sends a continuation prompt after an earlier prompt failure',
  );

  const invalidToolExecuteScenario = createPromptCollector();
  const invalidToolExecuteHook = createAutopilotHook(invalidToolExecuteScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  const invalidToolExecuteOutput: CommandOutput = { parts: [] };
  await invalidToolExecuteHook.handleToolExecute(
    { sessionID: 'session-invalid-tool-execute', task: 'bad loops', maxLoops: 0 },
    invalidToolExecuteOutput,
  );
  assertEqual(
    invalidToolExecuteOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nError: maxLoops must be a positive integer',
    'tool execute rejects non-positive maxLoops with the same validation as command parsing',
  );
  const normalHookWithoutTestControls = createAutopilotHook(createPromptCollector().ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  }) as unknown as Record<string, unknown>;
  assertEqual(
    normalHookWithoutTestControls.setReadinessForTest,
    undefined,
    'normal runtime hook does not expose test-only readiness override helpers',
  );
  assertEqual(
    normalHookWithoutTestControls.shouldAutoStartForTest,
    undefined,
    'normal runtime hook does not expose test-only auto-start helpers',
  );
  const invalidToolExecuteStatusOutput: CommandOutput = { parts: [] };
  await invalidToolExecuteHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-invalid-tool-execute', arguments: 'status' },
    invalidToolExecuteStatusOutput,
  );
  assertEqual(
    invalidToolExecuteStatusOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nAutopilot: disabled',
    'invalid tool execute does not start autopilot state',
  );
  await invalidToolExecuteHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-invalid-tool-execute' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    invalidToolExecuteScenario.prompts.length,
    0,
    'invalid tool execute does not enqueue continuation prompts',
  );

  const readinessBlockedScenario = createPromptCollector();
  const readinessBlockedHook = createAutopilotHookForTest(readinessBlockedScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  readinessBlockedHook.setReadinessForTest({
    configReadable: false,
    superpowersDeclared: false,
    autopilotInstalled: false,
    availableAgents: [],
    ready: false,
    missing: ['configUnreadable', 'superpowersUndeclared', 'autopilotMissing'],
  });
  const readinessBlockedOutput: CommandOutput = { parts: [] };
  await readinessBlockedHook.handleToolExecute(
    { sessionID: 'session-readiness-blocked', task: 'blocked start' },
    readinessBlockedOutput,
  );
  assertEqual(
    readinessBlockedOutput.parts[0]?.text,
    [
      '[AUTOPILOT-INTERNAL]',
      'Autopilot blocked: environment not ready.',
      'Missing: configUnreadable, superpowersUndeclared, autopilotMissing',
    ].join('\n'),
    'tool execution is blocked when readiness requirements are missing',
  );
  const readinessBlockedStatusOutput: CommandOutput = { parts: [] };
  await readinessBlockedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-readiness-blocked', arguments: 'status' },
    readinessBlockedStatusOutput,
  );
  assertEqual(
    readinessBlockedStatusOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nAutopilot: disabled',
    'blocked tool execution does not enable autopilot state',
  );

  const autoStartBlockedHook = createAutopilotHookForTest(createPromptCollector().ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  autoStartBlockedHook.setReadinessForTest({
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: false,
    availableAgents: [],
    ready: false,
    missing: ['autopilotMissing'],
  });
  assertEqual(
    autoStartBlockedHook.shouldAutoStartForTest({
      classification: 'FULL',
      artifactPaths: [],
      currentAction: 'implement feature',
      approvalPending: false,
    }),
    false,
    'FULL tasks do not auto-start when readiness fails',
  );

  const autoStartReadyHook = createAutopilotHookForTest(createPromptCollector().ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  autoStartReadyHook.setReadinessForTest({
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    availableAgents: [
      'autopilot-orchestrator',
      'autopilot-explorer',
      'autopilot-implementer',
      'autopilot-knowledge',
      'autopilot-designer',
      'autopilot-reviewer',
    ],
    ready: true,
    missing: [],
  });
  assertEqual(
    autoStartReadyHook.shouldAutoStartForTest({
      classification: 'FULL',
      artifactPaths: [],
      currentAction: 'implement feature',
      approvalPending: false,
    }),
    true,
    'FULL tasks auto-start when readiness is satisfied',
  );

  const resumeBlockedScenario = createPromptCollector();
  const resumeBlockedHook = createAutopilotHookForTest(resumeBlockedScenario.ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await resumeBlockedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume-blocked', arguments: '"resume blocked"' },
    { parts: [] },
  );
  await resumeBlockedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume-blocked', arguments: 'off' },
    { parts: [] },
  );
  resumeBlockedHook.setReadinessForTest({
    configReadable: true,
    superpowersDeclared: false,
    autopilotInstalled: true,
    availableAgents: [
      'autopilot-orchestrator',
      'autopilot-explorer',
      'autopilot-implementer',
      'autopilot-knowledge',
      'autopilot-designer',
      'autopilot-reviewer',
    ],
    ready: false,
    missing: ['superpowersUndeclared'],
  });
  const resumeBlockedOutput: CommandOutput = { parts: [] };
  await resumeBlockedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume-blocked', arguments: 'resume' },
    resumeBlockedOutput,
  );
  assert(
    resumeBlockedOutput.parts[0]?.text?.includes('Autopilot blocked: environment not ready.'),
    'resume is blocked when readiness requirements are missing',
  );
  const resumeBlockedStatusOutput: CommandOutput = { parts: [] };
  await resumeBlockedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-resume-blocked', arguments: 'status' },
    resumeBlockedStatusOutput,
  );
  assertEqual(
    resumeBlockedStatusOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nAutopilot: disabled',
    'blocked resume leaves autopilot disabled',
  );
  await resumeBlockedHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-resume-blocked' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    resumeBlockedScenario.prompts.length,
    0,
    'blocked resume does not enqueue continuation prompts',
  );

  const invalidFractionalToolExecuteScenario = createPromptCollector();
  const invalidFractionalToolExecuteHook = createAutopilotHook(
    invalidFractionalToolExecuteScenario.ctx,
    {
      defaultMaxLoops: 3,
      maxLoopsPerPhase: 2,
      cooldownMs: 0,
    },
  );
  const invalidFractionalToolExecuteOutput: CommandOutput = { parts: [] };
  await invalidFractionalToolExecuteHook.handleToolExecute(
    { sessionID: 'session-invalid-fractional-tool-execute', task: 'bad loops', maxLoops: 1.5 },
    invalidFractionalToolExecuteOutput,
  );
  assertEqual(
    invalidFractionalToolExecuteOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nError: maxLoops must be a positive integer',
    'tool execute rejects fractional maxLoops with integer validation',
  );

  const phaseResetScenario = createPromptCollector();
  const phaseResetHook = createAutopilotHook(phaseResetScenario.ctx, {
    defaultMaxLoops: 5,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });
  await phaseResetHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-phase-reset', arguments: '"phase reset"' },
    { parts: [] },
  );
  await phaseResetHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-phase-reset' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await phaseResetHook.handleEvent({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-phase-reset', status: { type: 'busy' } },
    },
  });
  await phaseResetHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-phase-reset' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await phaseResetHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-phase-reset' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(
    phaseResetScenario.prompts.length,
    3,
    'busy resets per-phase loop accumulation so later idle cycles do not stop early',
  );
  assert(
    !phaseResetScenario.prompts[2]?.body.parts[0]?.text?.includes('Autopilot stopped: reached max loops per phase'),
    'later idle after busy still continues instead of hitting a stale per-phase stop',
  );
}

void run();
