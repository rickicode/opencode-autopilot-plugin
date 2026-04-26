export interface AutopilotConfig {
  defaultMaxLoops: number;
  maxLoopsPerPhase: number;
  cooldownMs: number;
  stopOnError: boolean;
  stopBeforeMerge: boolean;
  maxConsecutiveContinuations: number;
  suppressAfterAbortMs: number;
  todoAware: boolean;
  questionDetection: boolean;
}

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
  pendingTimer: ReturnType<typeof setTimeout> | null;
  lastRecommendation: string | null;
  canAutoProceed: boolean;
  stagnationCount: number;
  lastObservedOutcome: 'progress' | 'no_progress' | 'blocked' | 'complete';
  lastPromptKind: 'start' | 'continue' | 'stop' | 'resume' | null;
  consecutiveContinuations: number;
  suppressUntil: number;
  isAutoInjecting: boolean;
  isNotifying: boolean;
}

export interface CommandInput {
  command: string;
  sessionID: string;
  arguments: string;
}

export interface CommandTextPart {
  type: 'text';
  text: string;
}

export interface CommandOutput {
  parts: CommandTextPart[];
}

export interface ToolExecuteInput {
  sessionID: string;
  task: string;
  maxLoops?: number;
}

export type AutopilotAgentRole =
  | 'orchestrator'
  | 'explorer'
  | 'implementer'
  | 'knowledge'
  | 'designer'
  | 'reviewer';

export type AutopilotAgentRoleFamily =
  | 'orchestration'
  | 'exploration'
  | 'implementation'
  | 'knowledge'
  | 'design'
  | 'review';

export type AutopilotAgentKind = 'primary' | 'delegated-specialist';

export type AutopilotAgentToolSurface =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Grep'
  | 'Glob'
  | 'Bash'
  | 'WebFetch';

export type AutopilotClassification = 'MICRO' | 'LIGHTWEIGHT' | 'FULL';

export type ReadinessMissingReason =
  | 'configUnreadable'
  | 'superpowersUndeclared'
  | 'autopilotMissing';

export type ReadinessTriggerReason =
  | 'full-execution'
  | 'approval-pending'
  | 'artifact-execution'
  | 'design-doc-action'
  | 'no-trigger';

export interface ReadinessResult {
  configReadable: boolean;
  superpowersDeclared: boolean;
  autopilotInstalled: boolean;
  availableAgents: string[];
  ready: boolean;
  missing: ReadinessMissingReason[];
}

export interface ReadinessEvaluationInput {
  configReadable: boolean;
  superpowersDeclared: boolean;
  autopilotInstalled: boolean;
  availableAgents: string[];
}

export interface ExecutionTriggerInput {
  classification: AutopilotClassification;
  artifactPaths: string[];
  currentAction: string;
  approvalPending: boolean;
}

export interface ExecutionTriggerResult {
  shouldAutoStart: boolean;
  reason: ReadinessTriggerReason;
}

export interface AutopilotHook {
  handleCommandExecuteBefore: (
    input: CommandInput,
    output: CommandOutput,
  ) => Promise<void>;
  handleToolExecute: (
    input: ToolExecuteInput,
    output: CommandOutput,
  ) => Promise<void>;
  handleEvent: (input: {
    event: { type: string; properties?: Record<string, unknown> };
  }) => Promise<void>;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  defaultMaxLoops: 10,
  maxLoopsPerPhase: 5,
  cooldownMs: 3000,
  stopOnError: true,
  stopBeforeMerge: true,
  maxConsecutiveContinuations: 5,
  suppressAfterAbortMs: 5000,
  todoAware: true,
  questionDetection: true,
};
