export interface AutopilotConfig {
  defaultMaxLoops: number;
  maxLoopsPerPhase: number;
  cooldownMs: number;
  stopOnError: boolean;
  stopBeforeMerge: boolean;
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
}

export interface CommandInput {
  command: string;
  sessionID: string;
  arguments: string;
}

export interface CommandOutput {
  parts: Array<{ type: string; text?: string }>;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  defaultMaxLoops: 10,
  maxLoopsPerPhase: 5,
  cooldownMs: 2000,
  stopOnError: true,
  stopBeforeMerge: true,
};
