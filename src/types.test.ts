import {
  DEFAULT_CONFIG,
  type AutopilotConfig,
  type IdleAction,
  type IdleAssessment,
  type IdleReason,
  type AutopilotState,
  type CommandInput,
  type CommandOutput,
  type CommandTextPart,
} from './types';

type Assert<T extends true> = T;
type IsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
        ? true
        : false)
    : false;

type _LastRecommendationRequired = Assert<
  IsRequired<AutopilotState, 'lastRecommendation'>
>;
type _CanAutoProceedRequired = Assert<
  IsRequired<AutopilotState, 'canAutoProceed'>
>;
type _StagnationCountRequired = Assert<
  IsRequired<AutopilotState, 'stagnationCount'>
>;
type _LastObservedOutcomeRequired = Assert<
  IsRequired<AutopilotState, 'lastObservedOutcome'>
>;
type _LastPromptKindRequired = Assert<
  IsRequired<AutopilotState, 'lastPromptKind'>
>;

type _LastRecommendationType = Assert<
  IsExact<AutopilotState['lastRecommendation'], string | null>
>;
type _CanAutoProceedType = Assert<
  IsExact<AutopilotState['canAutoProceed'], boolean>
>;
type _StagnationCountType = Assert<
  IsExact<AutopilotState['stagnationCount'], number>
>;
type _LastObservedOutcomeType = Assert<
  IsExact<
    AutopilotState['lastObservedOutcome'],
    'progress' | 'no_progress' | 'blocked' | 'complete'
  >
>;
type _LastPromptKindType = Assert<
  IsExact<
    AutopilotState['lastPromptKind'],
    'start' | 'continue' | 'stop' | 'resume' | null
  >
>;
type _CommandOutputPartType = Assert<
  IsExact<CommandOutput['parts'][number], CommandTextPart>
>;

const config: AutopilotConfig = DEFAULT_CONFIG;

const idleReason: IdleReason = 'verify_pending';

const idleAction: IdleAction = 'continue';

const idleAssessment: IdleAssessment = {
  reason: idleReason,
  action: idleAction,
  message: 'Verification still pending.',
  shouldIncrementLoop: false,
};

const state: AutopilotState = {
  enabled: true,
  sessionID: 'session-123',
  task: 'build plugin',
  maxLoops: 10,
  currentLoop: 1,
  currentPhase: 'design',
  phaseLoopCount: 1,
  startTime: Date.now(),
  lastActivity: Date.now(),
  pendingTimer: null,
  lastRecommendation: 'Ask user to review verification output.',
  canAutoProceed: true,
  stagnationCount: 0,
  lastObservedOutcome: 'progress',
  lastPromptKind: 'continue',
  consecutiveContinuations: 0,
  suppressUntil: 0,
  isAutoInjecting: false,
  isNotifying: false,
};

const input: CommandInput = {
  command: 'autopilot',
  sessionID: state.sessionID,
  arguments: 'status',
};

const output: CommandOutput = {
  parts: [{ type: 'text', text: input.command }],
};

const invalidOutputMissingText: CommandOutput = {
  // @ts-expect-error CommandOutput parts must require text content
  parts: [{ type: 'text' }],
};

const invalidOutputWrongType: CommandOutput = {
  // @ts-expect-error CommandOutput parts only allow text type
  parts: [{ type: 'image', text: 'autopilot' }],
};

const recommendation = state.lastRecommendation;
void invalidOutputMissingText;
void invalidOutputWrongType;

if (
  config.defaultMaxLoops !== 10 ||
  config.maxLoopsPerPhase !== 5 ||
  config.cooldownMs !== 3000 ||
  config.stopOnError !== true ||
  config.stopBeforeMerge !== true ||
  !state.enabled ||
  recommendation !== 'Ask user to review verification output.' ||
  state.canAutoProceed !== true ||
  state.stagnationCount !== 0 ||
  state.lastObservedOutcome !== 'progress' ||
  state.lastPromptKind !== 'continue' ||
  output.parts[0]?.text !== 'autopilot'
) {
  throw new Error('Autopilot types contract mismatch');
}
