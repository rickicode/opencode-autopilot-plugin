import type { CommandTextPart } from './types';

export function buildOrchestratorStartupGuidance(options: {
  task: string;
  maxLoops: number;
  executeStopLine: string;
  completeLine: string;
  completeStopLine: string;
  completeBehaviorLine?: string;
}): string {
  return [
    `Autopilot enabled: ${options.task}`,
    `Max loops: ${options.maxLoops}`,
    '',
    'You are the orchestrator for a superpowers-governed workflow.',
    'Superpowers is the policy layer. You are responsible for routing, delegation, and stop gates.',
    'Prefer slim-style specialists before built-in fallbacks.',
    'Do not default to inline implementation when delegation is available.',
    '1. Design (brainstorming) - auto-approve if unambiguous',
    '2. Plan (writing-plans) - auto-proceed to execution',
    '3. Execute (subagent-driven-development) - auto-continue through tasks',
    '4. Verify (verification-before-completion) - auto-proceed if pass',
    options.completeLine,
    '',
    'Stop and ask for user input only when:',
    '- Design: ambiguous requirements, multiple valid approaches',
    '- Plan: critical gaps, missing dependencies',
    options.executeStopLine,
    options.completeStopLine,
    ...(options.completeBehaviorLine
      ? ['', 'When completion does not require a stop:', options.completeBehaviorLine]
      : []),
    '',
    `Task: ${options.task}`,
  ].join('\n');
}

export function buildOrchestratorContinuationGuidance(options: {
  task: string;
  loopNumber: number;
  maxLoops: number;
  assessmentMessage: string;
  lastRecommendation: string | null;
}): string {
  return [
    `[Autopilot loop ${options.loopNumber}/${options.maxLoops}]`,
    `Task: ${options.task}`,
    'Continue as orchestrator.',
    'Check whether the next step should be delegated before doing work inline.',
    ...(options.lastRecommendation
      ? [`Recommended next step: ${options.lastRecommendation}`]
      : []),
    options.assessmentMessage,
  ].join('\n');
}

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

  const loopsMatch = trimmed.match(/^--loops\s+(\d+)\s+"([\s\S]+)"$/);
  if (loopsMatch) {
    const maxLoops = parseInt(loopsMatch[1], 10);
    const task = loopsMatch[2];

    if (maxLoops <= 0) {
      return { action: 'start', error: 'maxLoops must be positive' };
    }

    return { action: 'start', maxLoops, task };
  }

  const taskMatch = trimmed.match(/^"([\s\S]+)"$/);
  if (taskMatch) {
    return { action: 'start', task: taskMatch[1] };
  }

  return {
    action: 'start',
    error: 'Usage: /autopilot "task" or /autopilot --loops N "task"',
  };
}

export function createInternalPrompt(text: string): CommandTextPart {
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
