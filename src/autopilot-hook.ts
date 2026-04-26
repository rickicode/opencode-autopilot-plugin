import type { PluginInput } from '@opencode-ai/plugin';
import type {
  AutopilotConfig,
  AutopilotHook,
  IdleAssessment,
  AutopilotState,
  CommandInput,
  CommandOutput,
  ExecutionTriggerInput,
  ReadinessResult,
  ToolExecuteInput,
} from './types';
import { DEFAULT_CONFIG } from './types';
import {
  detectAutopilotExecutionTrigger,
  evaluateReadiness,
} from './readiness';
import {
  parseAutopilotCommand,
  createInternalPrompt,
  formatStatus,
  buildOrchestratorStartupGuidance,
  buildOrchestratorContinuationGuidance,
  isQuestion,
  countIncompleteTodos,
  buildCountdownNotification,
} from './utils';
import { AUTOPILOT_AGENT_IDS } from './agent-manifest';

type ParsedAutopilotCommand = ReturnType<typeof parseAutopilotCommand>;

const MAX_STAGNATION_LOOPS = 3;

function buildContinuationPrompt(
  state: AutopilotState,
  assessment: IdleAssessment,
  loopNumber = state.currentLoop,
): string {
  return buildOrchestratorContinuationGuidance({
    task: state.task,
    loopNumber,
    maxLoops: state.maxLoops,
    assessmentMessage: assessment.message,
    lastRecommendation:
      assessment.reason === 'blocked_soft' ? null : state.lastRecommendation,
  });
}

function validateMaxLoops(maxLoops?: number): string | undefined {
  if (
    maxLoops !== undefined &&
    (!Number.isInteger(maxLoops) || maxLoops <= 0)
  ) {
    return 'maxLoops must be a positive integer';
  }

  return undefined;
}

interface AutopilotHookTestControls {
  setReadinessForTest: (readinessLike: ReadinessResult) => void;
  shouldAutoStartForTest: (triggerInput: ExecutionTriggerInput) => boolean;
}

function buildStartupInstructions(
  state: AutopilotState,
  config: AutopilotConfig,
): string {
  const executeStopLine = config.stopOnError
    ? '- Execute: implementer BLOCKED, verification FAILED'
    : '- Execute: implementer BLOCKED, verification FAILED only if stopOnError=true';
  const completeLine = config.stopBeforeMerge
    ? '5. Complete (finishing-a-development-branch) - STOP for user decision'
    : '5. Complete (finishing-a-development-branch) - auto-proceed after verification; stopBeforeMerge=false';
  const completeStopLine = config.stopBeforeMerge
    ? '- Complete: always stop before merge/PR'
    : '';
  const completeBehaviorLine = config.stopBeforeMerge
    ? undefined
    : '- Complete: auto-proceed after verification; stopBeforeMerge=false';

  return buildOrchestratorStartupGuidance({
    task: state.task,
    maxLoops: state.maxLoops,
    executeStopLine,
    completeLine,
    completeStopLine,
    completeBehaviorLine,
  });
}

function getIdleContinuationMessage(state: AutopilotState): string {
  if (state.canAutoProceed && state.lastRecommendation) {
    return [
      `Continue using the previous recommendation: ${state.lastRecommendation}.`,
      'Do not stop only to ask for low-risk directional confirmation.',
      'Stop only for material ambiguity, a real blocker, or an irreversible decision.',
    ].join('\n');
  }

  return 'Continue with next step. Press Esc to stop.';
}

function getBlockedContinuationMessage(state: AutopilotState): string {
  const recommendation = state.lastRecommendation
    ? `Previous recommendation: ${state.lastRecommendation}.`
    : 'No prior recommendation is currently stored.';

  return [
    'Last observed outcome was blocked or errored.',
    recommendation,
    'Reassess the blocker, verify whether it is resolved, and only continue if the next step is safe and justified.',
  ].join('\n');
}

function consumeAutoProceedRecommendation(state: AutopilotState): void {
  if (state.canAutoProceed && state.lastRecommendation) {
    state.canAutoProceed = false;
    state.lastRecommendation = null;
  }
}

function restoreAutoProceedRecommendation(state: AutopilotState): void {
  if (!state.lastRecommendation && state.task) {
    state.lastRecommendation = `Continue advancing the current phase for: ${state.task}`;
  }
  state.canAutoProceed = true;
}

function assessIdleReason(
  state: AutopilotState,
  config: AutopilotConfig,
): IdleAssessment {
  if (state.currentPhase === 'complete' && config.stopBeforeMerge) {
    return {
      reason: 'waiting_user_decision',
      action: 'stop_for_user',
      message:
        'Autopilot stopped: task is complete and ready for user decision before merge or PR.',
      shouldIncrementLoop: false,
    };
  }

  if (state.currentLoop >= state.maxLoops) {
    return {
      reason: 'stalled_repeating',
      action: 'stop_autopilot',
      message: `Autopilot stopped: reached max loops (${state.maxLoops}).\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
      shouldIncrementLoop: false,
    };
  }

  if (state.lastObservedOutcome === 'blocked' && !config.stopOnError) {
    return {
      reason: 'blocked_soft',
      action: 'continue',
      message: getBlockedContinuationMessage(state),
      shouldIncrementLoop: true,
    };
  }

  if (state.phaseLoopCount >= config.maxLoopsPerPhase) {
    return {
      reason: 'blocked_soft',
      action: 'stop_autopilot',
      message: `Autopilot stopped: reached max loops per phase (${config.maxLoopsPerPhase}) in ${state.currentPhase} phase.\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
      shouldIncrementLoop: false,
    };
  }

  if (state.lastObservedOutcome === 'complete' && config.stopBeforeMerge) {
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
      message:
        'Autopilot stopped: no progress after repeated idle loops.\n\nUse /autopilot resume to continue, or /autopilot off to disable.',
      shouldIncrementLoop: false,
    };
  }

  if (state.canAutoProceed && state.lastRecommendation) {
    return {
      reason: 'waiting_direction',
      action: 'continue',
      message: getIdleContinuationMessage(state),
      shouldIncrementLoop: true,
    };
  }

  return {
    reason: 'unknown',
    action: 'continue',
    message: 'Continue with next step. Press Esc to stop.',
    shouldIncrementLoop: true,
  };
}

function createAutopilotHookInternal(
  ctx: PluginInput,
  userConfig?: Partial<AutopilotConfig>,
  includeTestControls = false,
): AutopilotHook | (AutopilotHook & AutopilotHookTestControls) {
  const config: AutopilotConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const sessions = new Map<string, AutopilotState>();
  const sessionRunVersions = new Map<string, number>();
  let readinessOverride: ReadinessResult | null = null;

  function resolveReadiness(): ReadinessResult {
    if (readinessOverride) {
      return readinessOverride;
    }

    return evaluateReadiness({
      configReadable: true,
      superpowersDeclared: true,
      autopilotInstalled: true,
      availableAgents: [...AUTOPILOT_AGENT_IDS],
    });
  }

  function formatReadinessBlockedMessage(readiness: ReadinessResult): string {
    return [
      'Autopilot blocked: environment not ready.',
      `Missing: ${readiness.missing.join(', ') || 'unknown'}`,
    ].join('\n');
  }

  function ensureReady(output: CommandOutput): boolean {
    const readiness = resolveReadiness();
    if (readiness.ready) {
      return true;
    }

    output.parts.push(
      createInternalPrompt(formatReadinessBlockedMessage(readiness)),
    );
    return false;
  }

  function shouldAutoStart(triggerInput: ExecutionTriggerInput): boolean {
    if (!resolveReadiness().ready) {
      return false;
    }

    return detectAutopilotExecutionTrigger(triggerInput).shouldAutoStart;
  }

  function getRunVersion(sessionID: string): number {
    return sessionRunVersions.get(sessionID) ?? 0;
  }

  function bumpRunVersion(sessionID: string): number {
    const nextVersion = getRunVersion(sessionID) + 1;
    sessionRunVersions.set(sessionID, nextVersion);
    return nextVersion;
  }

  function getOrCreateState(sessionID: string): AutopilotState {
    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, {
        enabled: false,
        sessionID,
        task: '',
        maxLoops: config.defaultMaxLoops,
        currentLoop: 0,
        currentPhase: 'design',
        phaseLoopCount: 0,
        startTime: 0,
        lastActivity: 0,
        pendingTimer: null,
        lastRecommendation: null,
        canAutoProceed: false,
        stagnationCount: 0,
        lastObservedOutcome: 'progress',
        lastPromptKind: null,
        consecutiveContinuations: 0,
        suppressUntil: 0,
        isAutoInjecting: false,
        isNotifying: false,
      });
    }

    if (!sessionRunVersions.has(sessionID)) {
      sessionRunVersions.set(sessionID, 0);
    }

    return sessions.get(sessionID)!;
  }

  function cancelPendingTimer(state: AutopilotState): void {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function resetState(sessionID: string): void {
    const state = sessions.get(sessionID);
    if (state) {
      cancelPendingTimer(state);
      sessions.delete(sessionID);
    }
    sessionRunVersions.delete(sessionID);
  }

  async function stopAutopilot(
    sessionID: string,
    state: AutopilotState,
    reasonText: string,
  ): Promise<void> {
    cancelPendingTimer(state);
    state.enabled = false;
    state.lastActivity = Date.now();
    state.lastPromptKind = 'stop';

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [createInternalPrompt(reasonText)],
      },
    });
  }

  async function executeParsedCommand(
    sessionID: string,
    parsed: ParsedAutopilotCommand,
    output: CommandOutput,
  ): Promise<void> {
    if (parsed.error) {
      output.parts.push(createInternalPrompt(`Error: ${parsed.error}`));
      return;
    }

    const state = getOrCreateState(sessionID);

    switch (parsed.action) {
      case 'off':
        bumpRunVersion(sessionID);
        cancelPendingTimer(state);
        state.enabled = false;
        state.canAutoProceed = false;
        state.lastRecommendation = null;
        output.parts.push(createInternalPrompt('Autopilot disabled.'));
        break;

      case 'status':
        output.parts.push(
          createInternalPrompt(
            [
              formatStatus(state),
              ...(state.lastRecommendation
                ? [`Recommendation: ${state.lastRecommendation}`]
                : []),
            ].join('\n'),
          ),
        );
        break;

      case 'resume':
        if (!state.task) {
          output.parts.push(
            createInternalPrompt('No previous autopilot session to resume.'),
          );
          return;
        }

        if (!ensureReady(output)) {
          return;
        }

        bumpRunVersion(sessionID);
        cancelPendingTimer(state);

        if (state.currentLoop >= state.maxLoops) {
          state.maxLoops = state.currentLoop + config.defaultMaxLoops;
        }
        if (state.phaseLoopCount >= config.maxLoopsPerPhase) {
          state.phaseLoopCount = 0;
        }
        if (state.currentPhase === 'complete') {
          state.currentPhase = 'execute';
          state.lastObservedOutcome = 'progress';
        }

        state.enabled = true;
        state.stagnationCount = 0;
        state.lastObservedOutcome = 'progress';
        state.consecutiveContinuations = 0;
        state.suppressUntil = 0;
        restoreAutoProceedRecommendation(state);
        state.lastPromptKind = 'resume';
        output.parts.push(
          createInternalPrompt(
            `Autopilot resumed: ${state.task}\nContinuing from loop ${state.currentLoop}/${state.maxLoops}`,
          ),
        );
        break;

      case 'start':
        if (!ensureReady(output)) {
          return;
        }

        if (!parsed.task) {
          output.parts.push(createInternalPrompt('Error: task is required'));
          return;
        }

        if (parsed.maxLoops !== undefined) {
          const maxLoopsError = validateMaxLoops(parsed.maxLoops);
          if (maxLoopsError) {
            output.parts.push(createInternalPrompt(`Error: ${maxLoopsError}`));
            return;
          }
        }

        bumpRunVersion(sessionID);
        cancelPendingTimer(state);

        state.enabled = true;
        state.task = parsed.task;
        state.maxLoops = parsed.maxLoops ?? config.defaultMaxLoops;
        state.currentLoop = 0;
        state.currentPhase = 'design';
        state.phaseLoopCount = 0;
        state.startTime = Date.now();
        state.lastActivity = Date.now();
        state.lastRecommendation = `Continue advancing the current phase for: ${state.task}`;
        state.canAutoProceed = true;
        state.stagnationCount = 0;
        state.lastObservedOutcome = 'progress';
        state.lastPromptKind = 'start';
        state.consecutiveContinuations = 0;
        state.suppressUntil = 0;
        state.isAutoInjecting = false;
        state.isNotifying = false;

        output.parts.push(
          createInternalPrompt(
            buildStartupInstructions(state, config),
          ),
        );
        break;
    }
  }

  async function handleCommandExecuteBefore(
    input: CommandInput,
    output: CommandOutput,
  ): Promise<void> {
    if (input.command !== 'autopilot') {
      return;
    }

    output.parts.length = 0;

    const parsed = parseAutopilotCommand(input.arguments);

    await executeParsedCommand(input.sessionID, parsed, output);
  }

  async function handleToolExecute(
    input: ToolExecuteInput,
    output: CommandOutput,
  ): Promise<void> {
    output.parts.length = 0;

    const maxLoopsError = validateMaxLoops(input.maxLoops);
    if (maxLoopsError) {
      output.parts.push(createInternalPrompt(`Error: ${maxLoopsError}`));
      return;
    }

    if (!ensureReady(output)) {
      return;
    }

    await executeParsedCommand(
      input.sessionID,
      {
        action: 'start',
        task: input.task,
        ...(input.maxLoops !== undefined ? { maxLoops: input.maxLoops } : {}),
      },
      output,
    );
  }

  async function checkQuestionGate(sessionID: string): Promise<boolean> {
    if (!config.questionDetection) {
      return false;
    }
    try {
      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      });
      const messages = messagesResult.data;
      const lastAssistantMessage = messages
        .slice()
        .reverse()
        .find((m) => m.info?.role === 'assistant');
      if (lastAssistantMessage?.parts) {
        const lastText = lastAssistantMessage.parts
          .map((p) => p.text ?? '')
          .join(' ');
        return isQuestion(lastText);
      }
    } catch {
      // graceful degradation: skip gate if API unavailable
    }
    return false;
  }

  async function checkTodoGate(
    sessionID: string,
  ): Promise<{ hasIncomplete: boolean; incompleteCount: number }> {
    if (!config.todoAware) {
      return { hasIncomplete: true, incompleteCount: 0 };
    }
    try {
      const todosResult = await ctx.client.session.todo({
        path: { id: sessionID },
      });
      const incompleteCount = countIncompleteTodos(todosResult.data);
      return { hasIncomplete: incompleteCount > 0, incompleteCount };
    } catch {
      // graceful degradation: skip gate if API unavailable
      return { hasIncomplete: true, incompleteCount: 0 };
    }
  }

  async function sendCountdownNotification(
    sessionID: string,
    incompleteCount: number,
  ): Promise<void> {
    const state = sessions.get(sessionID);
    if (state) {
      state.isNotifying = true;
    }
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: buildCountdownNotification(
                incompleteCount,
                config.cooldownMs / 1000,
              ),
            },
          ],
        },
      });
    } catch {
      // best-effort notification
    } finally {
      if (state) {
        state.isNotifying = false;
      }
    }
  }

  async function handleSessionIdle(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID);
    if (!state || !state.enabled) {
      return;
    }

    // Safety gate: no pending timer or injection in flight
    if (state.pendingTimer || state.isAutoInjecting) {
      return;
    }

    // Safety gate: not in abort suppress window
    if (Date.now() < state.suppressUntil) {
      return;
    }

    // Safety gate: max consecutive continuations
    if (state.consecutiveContinuations >= config.maxConsecutiveContinuations) {
      return;
    }

    const assessment = assessIdleReason(state, config);
    const runVersion = getRunVersion(sessionID);

    if (assessment.action === 'stop_complete') {
      await stopAutopilot(sessionID, state, assessment.message);
      return;
    }

    if (
      assessment.action === 'stop_for_user' ||
      assessment.action === 'stop_autopilot'
    ) {
      await stopAutopilot(sessionID, state, assessment.message);
      return;
    }

    // Safety gate: question detection
    const isLastMessageQuestion = await checkQuestionGate(sessionID);
    if (isLastMessageQuestion) {
      return;
    }

    // Safety gate: todo-aware continuation
    const { hasIncomplete, incompleteCount } =
      await checkTodoGate(sessionID);

    // Send countdown notification before scheduling continuation
    if (config.todoAware || config.questionDetection) {
      await sendCountdownNotification(sessionID, incompleteCount);
    }

    const pendingTimer = setTimeout(async () => {
      try {
        if (
          sessions.get(sessionID) !== state ||
          !state.enabled ||
          getRunVersion(sessionID) !== runVersion
        ) {
          return;
        }

        // Re-check suppress window in case user pressed Esc during cooldown
        if (Date.now() < state.suppressUntil) {
          return;
        }

        const currentAssessment = assessIdleReason(state, config);
        if (currentAssessment.action !== 'continue') {
          await stopAutopilot(sessionID, state, currentAssessment.message);
          return;
        }

        const nextLoop = currentAssessment.shouldIncrementLoop
          ? state.currentLoop + 1
          : state.currentLoop;

        state.isAutoInjecting = true;
        try {
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [
                createInternalPrompt(
                  buildContinuationPrompt(state, currentAssessment, nextLoop),
                ),
              ],
            },
          });
          state.consecutiveContinuations++;
        } finally {
          state.isAutoInjecting = false;
        }

        if (
          sessions.get(sessionID) !== state ||
          !state.enabled ||
          getRunVersion(sessionID) !== runVersion
        ) {
          return;
        }

        if (currentAssessment.shouldIncrementLoop) {
          state.currentLoop = nextLoop;
          state.phaseLoopCount += 1;
          if (currentAssessment.reason === 'blocked_soft') {
            state.stagnationCount = 0;
          } else {
            state.stagnationCount += 1;
          }
        }
        state.lastActivity = Date.now();
        if (currentAssessment.reason !== 'blocked_soft') {
          state.lastObservedOutcome = 'no_progress';
        }
        state.lastPromptKind = 'continue';

        if (currentAssessment.reason === 'waiting_direction') {
          consumeAutoProceedRecommendation(state);
        }
      } catch {
        return;
      } finally {
        if (state.pendingTimer === pendingTimer) {
          state.pendingTimer = null;
        }
      }
    }, config.cooldownMs);

    state.pendingTimer = pendingTimer;
  }

  async function handleEvent(input: {
    event: { type: string; properties?: Record<string, unknown> };
  }): Promise<void> {
    const { event } = input;

    if (event.type === 'session.idle') {
      const sessionID = event.properties?.sessionID as string;
      if (sessionID) {
        await handleSessionIdle(sessionID);
      }
    } else if (event.type === 'session.deleted') {
      const sessionID =
        ((event.properties?.info as { id?: string })?.id as string) ??
        (event.properties?.sessionID as string);
      if (sessionID) {
        resetState(sessionID);
      }
    } else if (event.type === 'session.error') {
      const sessionID = event.properties?.sessionID as string;
      const error = event.properties?.error as { name?: string } | undefined;
      const errorName = error?.name;
      if (sessionID) {
        const state = sessions.get(sessionID);
        if (state) {
          // Abort suppress window: after Esc/Ctrl+C, suppress auto-continue
          if (
            errorName === 'MessageAbortedError' ||
            errorName === 'AbortError'
          ) {
            state.suppressUntil = Date.now() + config.suppressAfterAbortMs;
          }
          cancelPendingTimer(state);
        }
      }
    } else if (event.type === 'session.status') {
      const sessionID = event.properties?.sessionID as string;
      const status = event.properties?.status as { type: string };
      if (sessionID && status?.type === 'idle') {
        await handleSessionIdle(sessionID);
      } else if (sessionID && status?.type === 'busy') {
        const state = sessions.get(sessionID);
        if (state) {
          // Always bump run version and cancel timers for safety
          bumpRunVersion(sessionID);
          cancelPendingTimer(state);
          // Reset consecutive counter only on user-initiated activity
          // (not our own auto-injection or countdown notification)
          if (
            !state.isAutoInjecting &&
            !state.isNotifying &&
            state.consecutiveContinuations > 0
          ) {
            state.consecutiveContinuations = 0;
          }
          if (state.currentPhase === 'complete') {
            state.currentPhase = 'execute';
          }
          state.phaseLoopCount = 0;
          state.stagnationCount = 0;
          state.lastObservedOutcome = 'progress';
          restoreAutoProceedRecommendation(state);
        }
      } else if (sessionID && status?.type === 'complete') {
        const state = sessions.get(sessionID);
        if (state) {
          bumpRunVersion(sessionID);
          cancelPendingTimer(state);
          state.currentPhase = 'complete';
          state.lastObservedOutcome = 'complete';
        }
      } else if (sessionID && status?.type === 'error') {
        const state = sessions.get(sessionID);
        if (state) {
          bumpRunVersion(sessionID);
          cancelPendingTimer(state);
          state.lastObservedOutcome = 'blocked';
          if (config.stopOnError) {
            await stopAutopilot(
              sessionID,
              state,
              'Autopilot stopped: verification failed or a critical error occurred.',
            );
          }
        }
      }
    }
  }

  const hook: AutopilotHook = {
    handleCommandExecuteBefore,
    handleToolExecute,
    handleEvent,
  };

  if (!includeTestControls) {
    return hook;
  }

  return {
    ...hook,
    setReadinessForTest: (readinessLike: ReadinessResult) => {
      readinessOverride = readinessLike;
    },
    shouldAutoStartForTest: (triggerInput: ExecutionTriggerInput) =>
      shouldAutoStart(triggerInput),
  };
}

export function createAutopilotHook(
  ctx: PluginInput,
  userConfig?: Partial<AutopilotConfig>,
): AutopilotHook {
  return createAutopilotHookInternal(ctx, userConfig, false) as AutopilotHook;
}

export function createAutopilotHookForTest(
  ctx: PluginInput,
  userConfig?: Partial<AutopilotConfig>,
): AutopilotHook & AutopilotHookTestControls {
  return createAutopilotHookInternal(
    ctx,
    userConfig,
    true,
  ) as AutopilotHook & AutopilotHookTestControls;
}
