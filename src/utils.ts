export function parseAutopilotCommand(args: string): {
  action: 'start' | 'off' | 'status' | 'resume';
  maxLoops?: number;
  task?: string;
  error?: string;
} {
  const trimmed = args.trim();

  if (trimmed === 'off') return { action: 'off' };
  if (trimmed === 'status') return { action: 'status' };
  if (trimmed === 'resume') return { action: 'resume' };

  const loopsMatch = trimmed.match(/^--loops\s+(\d+)\s+"(.+)"$/);
  if (loopsMatch) {
    const maxLoops = parseInt(loopsMatch[1], 10);
    const task = loopsMatch[2];

    if (maxLoops <= 0) {
      return { action: 'start', error: 'maxLoops must be positive' };
    }

    return { action: 'start', maxLoops, task };
  }

  const taskMatch = trimmed.match(/^"(.+)"$/);
  if (taskMatch) {
    return { action: 'start', task: taskMatch[1] };
  }

  return {
    action: 'start',
    error: 'Usage: /autopilot "task" or /autopilot --loops N "task"',
  };
}

export function createInternalPrompt(text: string): { type: string; text: string } {
  return {
    type: 'text',
    text: `[AUTOPILOT-INTERNAL]\n${text}`,
  };
}

export function formatStatus(state: {
  enabled: boolean;
  task: string;
  currentLoop: number;
  maxLoops: number;
  currentPhase: string;
  phaseLoopCount: number;
}): string {
  if (!state.enabled) {
    return 'Autopilot: disabled';
  }

  return [
    'Autopilot: enabled',
    `Task: ${state.task}`,
    `Progress: ${state.currentLoop}/${state.maxLoops} loops`,
    `Phase: ${state.currentPhase} (${state.phaseLoopCount} loops in phase)`,
  ].join('\n');
}
