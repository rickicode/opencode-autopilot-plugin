import type { PluginInput } from '@opencode-ai/plugin';
import type {
  AutopilotConfig,
  AutopilotHook,
  IdleAssessment,
  AutopilotState,
  ChatMessageInput,
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
  buildSuperpowersStartupGuidance,
  buildSuperpowersContinuationGuidance,
  isQuestion,
  countIncompleteTodos,
  buildCountdownNotification,
  buildTaskContextFromSuperpowers,
  readSuperpowersArtifacts,
  buildAutopilotActiveBanner,
} from './utils';
import { AUTOPILOT_AGENT_IDS, AUTOPILOT_AGENT_MANIFEST } from './agent-manifest';

const SUPERPOWERS_PRIMARY_AGENT_ID = AUTOPILOT_AGENT_MANIFEST.superpowers.id;
import { getSuperpowersDelegationGuide } from './subagents';

type ParsedAutopilotCommand = ReturnType<typeof parseAutopilotCommand>;

const MAX_STAGNATION_LOOPS = 7;

function buildContinuationPrompt(
  state: AutopilotState,
  assessment: IdleAssessment,
  loopNumber = state.currentLoop,
): string {
  const verification = getActiveTaskVerification(state);
  return buildSuperpowersContinuationGuidance({
    task: state.activeTaskTitle
      ? `${state.task}\nActive execute task: ${state.activeTaskTitle}`
      : state.task,
    loopNumber,
    maxLoops: state.maxLoops,
    assessmentMessage: assessment.message,
    lastRecommendation:
      assessment.reason === 'blocked_soft' ? null : state.lastRecommendation,
    activeTaskVerification: verification,
    currentPhase: state.currentPhase,
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
  projectDir?: string,
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

  let taskContext: string | undefined;
  if (projectDir) {
    const superpowersContext = buildTaskContextFromSuperpowers(projectDir);
    if (superpowersContext) {
      taskContext = superpowersContext;
    }
  }

  const delegationGuide = getSuperpowersDelegationGuide();
  const verification = getActiveTaskVerification(state);
  const fullDelegationGuide = taskContext
    ? `${delegationGuide}\n\n${taskContext}`
    : delegationGuide;
  const enrichedDelegationGuide = verification.length > 0
    ? [
        fullDelegationGuide,
        '### Active Task Verification',
        ...verification.map((item) => `- ${item}`),
      ].join('\n\n').replace('\n\n- ', '\n- ')
    : fullDelegationGuide;

  return buildSuperpowersStartupGuidance({
    task: state.activeTaskTitle
      ? `${state.task}\nActive execute task: ${state.activeTaskTitle}`
      : state.task,
    maxLoops: state.maxLoops,
    executeStopLine,
    completeLine,
    completeStopLine,
    completeBehaviorLine,
    delegationGuide: enrichedDelegationGuide,
  });
}

function hydrateExecutionStateFromArtifacts(
  state: AutopilotState,
  projectDir?: string,
): void {
  state.activeSpecPath = null;
  state.activePlanPath = null;
  state.planTasks = [];
  state.activeTaskId = null;
  state.activeTaskTitle = null;
  state.pendingTaskIds = [];
  state.completedTaskIds = [];
  state.verifyOutcome = null;
  state.lastVerifyIssueName = null;
  state.lastVerifiedTaskTitle = null;
  state.lastCompletedTaskTitle = null;

  if (!projectDir) {
    return;
  }

  const artifacts = readSuperpowersArtifacts(projectDir);
  if (!artifacts.hasSuperpowers) {
    return;
  }

  state.activeSpecPath = artifacts.specPaths[0] ?? null;
  const activePlan = artifacts.planDocuments.find((plan) => plan.tasks.length > 0);
  if (!activePlan) {
    state.activePlanPath = artifacts.planPaths[0] ?? null;
    return;
  }

  state.activePlanPath = activePlan.path;
  state.planTasks = activePlan.tasks.map((task) => ({
    ...task,
    verification: [...task.verification],
  }));

  const activeTask =
    activePlan.tasks.find((task) => task.status !== 'completed') ?? activePlan.tasks[0];
  state.activeTaskId = activeTask?.id ?? null;
  if (state.activeTaskId) {
    markTaskStatus(state, state.activeTaskId, 'in_progress');
  } else {
    syncDerivedTaskState(state);
  }

  const lastCompletedTask = [...state.planTasks]
    .reverse()
    .find((task) => task.status === 'completed');
  state.lastCompletedTaskTitle = lastCompletedTask?.title ?? null;
  state.lastVerifiedTaskTitle = null;
}

function getIdleContinuationMessage(state: AutopilotState): string {
  if (state.canAutoProceed && state.lastRecommendation) {
    const verification = getActiveTaskVerification(state);
    return [
      `Continue using the previous recommendation: ${state.lastRecommendation}.`,
      ...(verification.length > 0
        ? ['Active task verification:', ...verification.map((item) => `- ${item}`)]
        : []),
      'Do not stop only to ask for low-risk directional confirmation.',
      'Stop only for material ambiguity, a real blocker, or an irreversible decision.',
    ].join('\n');
  }

  return 'Continue with next step. Press Esc to stop.';
}

function getExecutionFocus(state: AutopilotState): string {
  if (!state.activeTaskTitle) {
    return state.task;
  }

  return `the active plan task "${state.activeTaskTitle}" for: ${state.task}`;
}

function getActiveTaskVerification(state: AutopilotState): string[] {
  if (!state.activeTaskId) {
    return [];
  }

  const activeTask = state.planTasks.find((task) => task.id === state.activeTaskId);
  return activeTask ? [...activeTask.verification] : [];
}

function getActiveTask(state: AutopilotState) {
  if (!state.activeTaskId) {
    return null;
  }

  return state.planTasks.find((task) => task.id === state.activeTaskId) ?? null;
}

function syncDerivedTaskState(state: AutopilotState): void {
  state.pendingTaskIds = state.planTasks
    .filter((task) => task.status !== 'completed')
    .map((task) => task.id);
  state.completedTaskIds = state.planTasks
    .filter((task) => task.status === 'completed')
    .map((task) => task.id);

  const activeTask = getActiveTask(state);
  state.activeTaskTitle = activeTask?.title ?? null;
}

function markTaskStatus(
  state: AutopilotState,
  taskId: string | null,
  status: 'pending' | 'in_progress' | 'completed',
): void {
  if (!taskId) {
    return;
  }

  const task = state.planTasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return;
  }

  task.status = status;
  syncDerivedTaskState(state);
}

function activeTaskRequiresVerification(state: AutopilotState): boolean {
  return getActiveTaskVerification(state).length > 0;
}

function canFinalizePlanCompletion(state: AutopilotState): boolean {
  if (state.planTasks.length === 0) {
    return true;
  }

  if (state.activeTaskId || state.pendingTaskIds.length > 0) {
    return false;
  }

  return !state.planTasks.some((task) => task.status === 'in_progress');
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

function getVerifyPendingContinuationMessage(state: AutopilotState): string {
  return [
    `Verification is still pending for ${getExecutionFocus(state)}.`,
    'Run the listed verification steps, confirm they pass, and only then advance to the next task.',
    'Do not treat implementation as finished until the verification requirements are satisfied.',
  ].join('\n');
}

function getVerifyFailedContinuationMessage(state: AutopilotState): string {
  return [
    `Fix and re-verify ${getExecutionFocus(state)}.`,
    'Fix the verification failure, rerun the required checks, and only then advance to the next task.',
    'Do not proceed to the next task until the verification steps pass.',
  ].join('\n');
}

function getVerifyIssueContinuationMessage(state: AutopilotState): string {
  return [
    `Verification is blocked by an environment or tooling issue for ${getExecutionFocus(state)}.`,
    'Stabilize the environment, restore the required tools, and rerun the verification steps before advancing.',
    'Do not proceed to the next task until the verification environment is working again.',
  ].join('\n');
}

function buildPhaseRecommendation(state: AutopilotState): string | null {
  if (!state.task) {
    return null;
  }

  if (state.currentPhase === 'verify' && state.verifyOutcome === 'failed') {
    return `Fix and re-verify ${getExecutionFocus(state)}`;
  }

  if (state.currentPhase === 'verify' && state.verifyOutcome === 'issue') {
    return `Restore the environment and re-verify ${getExecutionFocus(state)}`;
  }

  if (state.currentPhase === 'verify') {
    return `Verify ${getExecutionFocus(state)}`;
  }

  return `Continue advancing ${getExecutionFocus(state)}`;
}

function consumeAutoProceedRecommendation(state: AutopilotState): void {
  if (state.canAutoProceed && state.lastRecommendation) {
    state.canAutoProceed = false;
    state.lastRecommendation = null;
  }
}

function restoreAutoProceedRecommendation(state: AutopilotState): void {
  if (!state.lastRecommendation) {
    state.lastRecommendation = buildPhaseRecommendation(state);
  }
  state.canAutoProceed = true;
}

function advanceToNextPlannedTask(state: AutopilotState): boolean {
  if (!state.activeTaskId && state.pendingTaskIds.length === 0) {
    return false;
  }

  markTaskStatus(state, state.activeTaskId, 'completed');

  const nextTaskId = state.pendingTaskIds[0] ?? null;
  if (!nextTaskId) {
    state.activeTaskId = null;
    state.activeTaskTitle = null;
    return false;
  }

  state.activeTaskId = nextTaskId;
  markTaskStatus(state, nextTaskId, 'in_progress');
  if (!state.activeTaskTitle) {
    state.activeTaskTitle = `Task ${nextTaskId.replace(/^task-/, '')}`;
  }
  return true;
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

  if (
    state.currentPhase === 'verify' &&
    state.verifyOutcome === 'issue' &&
    state.lastObservedOutcome === 'blocked' &&
    !config.stopOnError
  ) {
    return {
      reason: 'verify_issue',
      action: 'continue',
      message: getVerifyIssueContinuationMessage(state),
      shouldIncrementLoop: true,
    };
  }

  if (
    state.currentPhase === 'verify' &&
    state.verifyOutcome === 'failed' &&
    state.lastObservedOutcome === 'blocked' &&
    !config.stopOnError
  ) {
    return {
      reason: 'verify_failed',
      action: 'continue',
      message: getVerifyFailedContinuationMessage(state),
      shouldIncrementLoop: true,
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

  if (state.currentPhase === 'verify' && state.canAutoProceed && state.lastRecommendation) {
    return {
      reason: 'verify_pending',
      action: 'continue',
      message: getVerifyPendingContinuationMessage(state),
      shouldIncrementLoop: true,
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
  const superpowersSessions = new Set<string>();
  const autoEnabledSessions = new Set<string>();
  let readinessOverride: ReadinessResult | null = null;

  function resolveReadiness(): ReadinessResult {
    if (readinessOverride) {
      return readinessOverride;
    }

    // Plugin is loaded, so config was readable
    const configReadable = true;
    const superpowersDeclared = checkSuperpowersDeclared();
    return evaluateReadiness({
      configReadable,
      superpowersDeclared,
      autopilotInstalled: true,
      autopilotCommandFileInstalled: true,
      availableAgents: [...AUTOPILOT_AGENT_IDS],
      artifactPaths: ctx.directory
        ? ['docs/superpowers/specs', 'docs/superpowers/plans']
        : [],
    });
  }

  function checkSuperpowersDeclared(): boolean {
    if (!ctx.directory) {
      return false;
    }
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
        const superpowersDir = path.join(ctx.directory, 'docs', 'superpowers');
      return fs.existsSync(superpowersDir);
    } catch {
      return false;
    }
  }

  function formatReadinessBlockedMessage(readiness: ReadinessResult): string {
    return [
      'Autopilot blocked: environment not ready.',
      `Missing: ${readiness.missing.join(', ') || 'unknown'}`,
    ].join('\n');
  }

  function ensureReady(output: CommandOutput): boolean {
    const readiness = resolveReadiness();
    // Autopilot is ready if no blocking issues exist.
    // superpowersUndeclared is informational — doesn't block startup.
    const blockingMissing = readiness.missing.filter(
      (m) => m !== 'superpowersUndeclared',
    );
    if (blockingMissing.length === 0) {
      return true;
    }

    output.parts.push(
      createInternalPrompt(formatReadinessBlockedMessage(readiness)),
    );
    return false;
  }

  function shouldAutoStart(triggerInput: ExecutionTriggerInput): boolean {
    const readiness = resolveReadiness();
    const blockingMissing = readiness.missing.filter(
      (m) => m !== 'superpowersUndeclared',
    );
    if (blockingMissing.length > 0) {
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
        activeSpecPath: null,
        activePlanPath: null,
        planTasks: [],
        activeTaskId: null,
        activeTaskTitle: null,
        pendingTaskIds: [],
        completedTaskIds: [],
        verifyOutcome: null,
        lastVerifyIssueName: null,
        lastVerifiedTaskTitle: null,
        lastCompletedTaskTitle: null,
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

  function handleChatMessage(input: ChatMessageInput): void {
    if (!input.sessionID) {
      return;
    }

    if (
      input.agent === SUPERPOWERS_PRIMARY_AGENT_ID ||
      input.agent === undefined
    ) {
      // OpenCode does not always provide an explicit agent on chat.message;
      // fall back to registering when the host is configured with superpowers
      // as the default agent. Auto-enable later still requires the
      // autoEnable config flag.
      superpowersSessions.add(input.sessionID);
    }
  }

  async function maybeAutoEnableForSuperpowers(
    sessionID: string,
  ): Promise<AutopilotState | null> {
    if (!config.autoEnable) {
      return null;
    }

    if (!superpowersSessions.has(sessionID)) {
      return null;
    }

    const existingState = sessions.get(sessionID);
    if (existingState?.enabled) {
      return existingState;
    }

    if (autoEnabledSessions.has(sessionID)) {
      // Already auto-enabled previously and the user disabled it — do not
      // re-trigger automatically until the next user-initiated message.
      return null;
    }

    const readiness = resolveReadiness();
    const blockingMissing = readiness.missing.filter(
      (m) => m !== 'superpowersUndeclared',
    );
    if (blockingMissing.length > 0) {
      return null;
    }

    const inferredTask = await inferAutoEnableTask(sessionID);

    const state = getOrCreateState(sessionID);
    bumpRunVersion(sessionID);
    cancelPendingTimer(state);

    state.enabled = true;
    state.task = inferredTask;
    hydrateExecutionStateFromArtifacts(state, ctx.directory);
    state.maxLoops = config.defaultMaxLoops;
    state.currentLoop = 0;
    state.currentPhase = 'execute';
    state.phaseLoopCount = 0;
    state.startTime = Date.now();
    state.lastActivity = Date.now();
    state.lastRecommendation = buildPhaseRecommendation(state);
    state.canAutoProceed = true;
    state.stagnationCount = 0;
    state.lastObservedOutcome = 'progress';
    state.lastPromptKind = 'start';
    state.consecutiveContinuations = 0;
    state.suppressUntil = 0;
    state.isAutoInjecting = false;
    state.isNotifying = false;

    autoEnabledSessions.add(sessionID);

    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: [
                buildAutopilotActiveBanner('enabled'),
                `Auto-enabled after Superpowers idle (max ${state.maxLoops} loops). Esc×2 to cancel, /autopilot off to disable.`,
              ].join('\n'),
            },
          ],
        },
      });
    } catch {
      // best-effort visibility notification
    }

    return state;
  }

  async function inferAutoEnableTask(sessionID: string): Promise<string> {
    try {
      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      });
      const messages = messagesResult.data ?? [];
      const lastUserMessage = messages
        .slice()
        .reverse()
        .find((m) => m.info?.role === 'user');
      if (lastUserMessage?.parts) {
        const text = lastUserMessage.parts
          .map((p) => (typeof p.text === 'string' ? p.text : ''))
          .join('\n')
          .trim();
        if (text) {
          return text.length > 200 ? `${text.slice(0, 200)}…` : text;
        }
      }
    } catch {
      // graceful degradation: fall back to placeholder
    }
    return 'Continue current Superpowers task';
  }

  async function autoStartFromTrigger(
    sessionID: string,
    triggerInput: ExecutionTriggerInput,
  ): Promise<boolean> {
    if (!shouldAutoStart(triggerInput)) {
      return false;
    }

    const state = getOrCreateState(sessionID);
    if (state.enabled) {
      return false;
    }

    bumpRunVersion(sessionID);
    cancelPendingTimer(state);

    state.enabled = true;
    state.task = triggerInput.currentAction;
    hydrateExecutionStateFromArtifacts(state, ctx.directory);
    state.maxLoops = config.defaultMaxLoops;
    state.currentLoop = 0;
    state.currentPhase = 'execute';
    state.phaseLoopCount = 0;
    state.startTime = Date.now();
    state.lastActivity = Date.now();
    state.lastRecommendation = buildPhaseRecommendation(state);
    state.canAutoProceed = true;
    state.stagnationCount = 0;
    state.lastObservedOutcome = 'progress';
    state.lastPromptKind = 'start';
    state.consecutiveContinuations = 0;
    state.suppressUntil = 0;
    state.isAutoInjecting = false;
    state.isNotifying = false;

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [
          createInternalPrompt(
            [
              buildAutopilotActiveBanner('enabled'),
              buildStartupInstructions(state, config, ctx.directory),
            ].join('\n\n'),
          ),
        ],
      },
    });

    return true;
  }

  function readExecutionTriggerInput(
    properties?: Record<string, unknown>,
  ): ExecutionTriggerInput | null {
    if (!properties) {
      return null;
    }

    const classification = properties.classification;
    const currentAction = properties.currentAction;
    const approvalPending = properties.approvalPending;
    const artifactPaths = properties.artifactPaths;

    if (
      classification !== 'MICRO' &&
      classification !== 'LIGHTWEIGHT' &&
      classification !== 'FULL'
    ) {
      return null;
    }

    if (typeof currentAction !== 'string' || !Array.isArray(artifactPaths)) {
      return null;
    }

    return {
      classification,
      currentAction,
      approvalPending: approvalPending === true,
      artifactPaths: artifactPaths.filter(
        (artifactPath): artifactPath is string => typeof artifactPath === 'string',
      ),
    };
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
    superpowersSessions.delete(sessionID);
    autoEnabledSessions.delete(sessionID);
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
        const activeTask = getActiveTask(state);
        const activeTaskVerificationRequired = activeTask
          ? activeTask.verification.length > 0
          : null;
        const idleReason =
          state.currentPhase === 'verify'
            ? state.verifyOutcome === 'issue'
              ? 'verify_issue'
              : state.verifyOutcome === 'failed'
                ? 'verify_failed'
                : activeTaskVerificationRequired
                  ? 'verify_pending'
                  : null
            : null;
        const planTaskCounts = state.planTasks.length > 0
          ? {
              completed: state.planTasks.filter((task) => task.status === 'completed').length,
              pending: state.planTasks.filter((task) => task.status !== 'completed').length,
            }
          : null;
        output.parts.push(
          createInternalPrompt(
            [
              formatStatus({
                ...state,
                activeTaskStatus: activeTask?.status ?? null,
                activeTaskVerificationRequired,
                idleReason,
                verifyOutcome: state.verifyOutcome,
                lastVerifyIssueName: state.lastVerifyIssueName,
                planTaskCounts,
              }),
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

        if (parsed.maxLoops !== undefined) {
          const maxLoopsError = validateMaxLoops(parsed.maxLoops);
          if (maxLoopsError) {
            output.parts.push(createInternalPrompt(`Error: ${maxLoopsError}`));
            return;
          }
        }

        if (!ensureReady(output)) {
          return;
        }

        bumpRunVersion(sessionID);
        cancelPendingTimer(state);

        if (parsed.maxLoops !== undefined) {
          state.maxLoops = parsed.maxLoops;
        } else if (state.currentLoop >= state.maxLoops) {
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
            [
              buildAutopilotActiveBanner('resumed'),
              `Autopilot resumed: ${state.task}`,
              `Continuing from loop ${state.currentLoop}/${state.maxLoops}`,
            ].join('\n'),
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
        hydrateExecutionStateFromArtifacts(state, ctx.directory);
        state.maxLoops = parsed.maxLoops ?? config.defaultMaxLoops;
        state.currentLoop = 0;
        state.currentPhase = 'design';
        state.phaseLoopCount = 0;
        state.startTime = Date.now();
        state.lastActivity = Date.now();
        state.lastRecommendation = buildPhaseRecommendation(state);
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
            [
              buildAutopilotActiveBanner('enabled'),
              buildStartupInstructions(state, config, ctx.directory),
            ].join('\n\n'),
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

    if (typeof input.raw === 'string' && input.raw.trim().length > 0) {
      const parsed = parseAutopilotCommand(input.raw);
      await executeParsedCommand(input.sessionID, parsed, output);
      return;
    }

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
  ): Promise<{ incompleteCount: number }> {
    if (!config.todoAware) {
      return { incompleteCount: 0 };
    }
    try {
      const todosResult = await ctx.client.session.todo({
        path: { id: sessionID },
      });
      const incompleteCount = countIncompleteTodos(todosResult.data);
      return { incompleteCount };
    } catch {
      // graceful degradation: skip gate if API unavailable
      return { incompleteCount: 0 };
    }
  }

  async function sendCountdownNotification(
    sessionID: string,
    incompleteCount: number | null,
    loopProgress?: { current: number; max: number },
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
                loopProgress,
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
    let state = sessions.get(sessionID);

    // Auto-engage: when /autopilot was never invoked but the session has been
    // driven by the superpowers agent and autoEnable is on, take over now so
    // the user does not need to type /autopilot manually after Superpowers
    // finishes a task.
    if (!state || !state.enabled) {
      const autoEnabled = await maybeAutoEnableForSuperpowers(sessionID);
      if (autoEnabled) {
        state = autoEnabled;
      }
    }

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
      await stopAutopilot(
        sessionID,
        state,
        `Autopilot stopped: reached max consecutive idle auto-continues (${config.maxConsecutiveContinuations}).\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
      );
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
    const { incompleteCount } = await checkTodoGate(sessionID);
    if (config.todoAware && incompleteCount === 0) {
      return;
    }

    // Send a countdown notification before scheduling continuation so the
    // user has inline visibility that autopilot is taking over and can
    // press Esc×2 to cancel before the auto-injection fires. Skip the
    // notification only when the cooldown is zero (deterministic test
    // mode) — there's no useful window to display in that case.
    if (config.cooldownMs > 0) {
      const projectedNextLoop = assessment.shouldIncrementLoop
        ? state.currentLoop + 1
        : state.currentLoop;
      await sendCountdownNotification(
        sessionID,
        config.todoAware ? incompleteCount : null,
        { current: projectedNextLoop, max: state.maxLoops },
      );
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
          } else if (state.currentPhase === 'verify') {
            state.verifyOutcome = 'issue';
            state.lastVerifyIssueName = errorName ?? 'UnknownError';
            state.lastObservedOutcome = 'blocked';
            state.lastRecommendation = buildPhaseRecommendation(state);
            state.canAutoProceed = true;
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
        } else if (sessionID) {
          const triggerInput = readExecutionTriggerInput(event.properties);
          if (triggerInput) {
            await autoStartFromTrigger(sessionID, triggerInput);
          }
        }
        } else if (sessionID && status?.type === 'complete') {
          const state = sessions.get(sessionID);
          if (state) {
            bumpRunVersion(sessionID);
            cancelPendingTimer(state);
            if (
              state.currentPhase !== 'verify' &&
              state.activeTaskId &&
              activeTaskRequiresVerification(state)
            ) {
              state.lastCompletedTaskTitle = state.activeTaskTitle;
              state.verifyOutcome = 'pending';
              state.lastVerifyIssueName = null;
              state.currentPhase = 'verify';
              state.phaseLoopCount = 0;
              state.stagnationCount = 0;
              state.lastObservedOutcome = 'progress';
              state.lastRecommendation = buildPhaseRecommendation(state);
              state.canAutoProceed = true;
            } else if (advanceToNextPlannedTask(state)) {
              state.lastVerifiedTaskTitle = state.lastCompletedTaskTitle ?? state.lastVerifiedTaskTitle;
              state.verifyOutcome = 'passed';
              state.lastVerifyIssueName = null;
              state.currentPhase = 'execute';
              state.phaseLoopCount = 0;
              state.stagnationCount = 0;
              state.lastObservedOutcome = 'progress';
              state.lastRecommendation = buildPhaseRecommendation(state);
              state.canAutoProceed = true;
            } else if (canFinalizePlanCompletion(state)) {
              if (state.currentPhase === 'verify') {
                state.lastVerifiedTaskTitle = state.lastCompletedTaskTitle ?? state.lastVerifiedTaskTitle;
                state.verifyOutcome = 'passed';
                state.lastVerifyIssueName = null;
              }
              state.currentPhase = 'complete';
              state.lastObservedOutcome = 'complete';
              if (state.planTasks.length > 0) {
                state.lastRecommendation = null;
                state.canAutoProceed = false;
              } else {
                state.lastRecommendation = buildPhaseRecommendation(state);
                state.canAutoProceed = true;
              }
            } else {
              state.currentPhase = 'execute';
              state.phaseLoopCount = 0;
              state.stagnationCount = 0;
              state.lastObservedOutcome = 'progress';
              state.lastRecommendation = buildPhaseRecommendation(state);
              state.canAutoProceed = true;
            }
          }
        } else if (sessionID && status?.type === 'error') {
        const state = sessions.get(sessionID);
        if (state) {
          bumpRunVersion(sessionID);
          cancelPendingTimer(state);
          if (state.currentPhase === 'verify' && state.verifyOutcome !== 'issue') {
            state.verifyOutcome = 'failed';
            state.lastVerifyIssueName = null;
            state.lastRecommendation = buildPhaseRecommendation(state);
            state.canAutoProceed = true;
          }
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
    handleChatMessage,
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
