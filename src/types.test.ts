import {
  DEFAULT_CONFIG,
  type AutopilotConfig,
  type AutopilotState,
  type CommandInput,
  type CommandOutput,
} from './types';

const config: AutopilotConfig = DEFAULT_CONFIG;

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
};

const input: CommandInput = {
  command: 'autopilot',
  sessionID: state.sessionID,
  arguments: 'status',
};

const output: CommandOutput = {
  parts: [{ type: 'text', text: input.command }],
};

if (
  config.defaultMaxLoops !== 10 ||
  !state.enabled ||
  output.parts[0]?.text !== 'autopilot'
) {
  throw new Error('Autopilot types contract mismatch');
}
