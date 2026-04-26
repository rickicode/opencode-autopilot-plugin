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
  autoEnable: boolean;
}

export type IdleReason =
  | 'waiting_direction'
  | 'waiting_user_decision'
  | 'blocked_soft'
  | 'blocked_hard'
  | 'verify_pending'
  | 'verify_failed'
  | 'verify_issue'
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
  activeSpecPath: string | null;
  activePlanPath: string | null;
  planTasks: ParsedPlanTask[];
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  pendingTaskIds: string[];
  completedTaskIds: string[];
  verifyOutcome: 'pending' | 'failed' | 'passed' | 'issue' | null;
  lastVerifyIssueName: string | null;
  lastVerifiedTaskTitle: string | null;
  lastCompletedTaskTitle: string | null;
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
  task?: string;
  raw?: string;
  maxLoops?: number;
}

export type AutopilotAgentRole =
  | 'superpowers'
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
  | 'autopilotMissing'
  | 'autopilotCommandFileMissing';

export type ReadinessTriggerReason =
  | 'approval-pending'
  | 'artifact-execution'
  | 'design-doc-action'
  | 'no-trigger';

export interface ReadinessResult {
  configReadable: boolean;
  superpowersDeclared: boolean;
  autopilotInstalled: boolean;
  installReady: boolean;
  executionReady: boolean;
  availableAgents: string[];
  ready: boolean;
  missing: ReadinessMissingReason[];
}

export interface ReadinessEvaluationInput {
  configReadable: boolean;
  superpowersDeclared: boolean;
  autopilotInstalled: boolean;
  autopilotCommandFileInstalled: boolean;
  availableAgents: string[];
  artifactPaths?: string[];
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

export interface ParsedPlanTask {
  id: string;
  title: string;
  body: string;
  verification: string[];
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ParsedPlanDocument {
  path: string;
  title: string | null;
  tasks: ParsedPlanTask[];
}

export interface ChatMessageInput {
  sessionID: string;
  agent?: string;
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
  handleChatMessage: (input: ChatMessageInput) => void;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  defaultMaxLoops: 7,
  maxLoopsPerPhase: 7,
  cooldownMs: 3000,
  stopOnError: true,
  stopBeforeMerge: true,
  maxConsecutiveContinuations: 7,
  suppressAfterAbortMs: 5000,
  todoAware: false,
  questionDetection: false,
  autoEnable: true,
};
