import type {
  CommandTextPart,
  ParsedPlanDocument,
  ParsedPlanTask,
} from './types';

const QUESTION_PATTERNS: RegExp[] = [
  /\bwould you like\b/,
  /\bshould i\b/,
  /\bdo you want\b/,
  /\bplease review\b/,
  /\blet me know\b/,
  /\bwhat do you think\b/,
  /\bcan you confirm\b/,
  /\bwould you prefer\b/,
  /\bshall i\b/,
  /\bany thoughts\b/,
];

const TERMINAL_TODO_STATUSES = ['completed', 'cancelled'];

export function isQuestion(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  if (/\?$/.test(lowerText)) {
    return true;
  }
  return QUESTION_PATTERNS.some((pattern) => pattern.test(lowerText));
}

export function countIncompleteTodos(
  todos: Array<{ status: string }>,
): number {
  return todos.filter(
    (todo) => !TERMINAL_TODO_STATUSES.includes(todo.status),
  ).length;
}

export function buildCountdownNotification(
  incompleteCount: number | null,
  cooldownSec: number,
  loopProgress?: { current: number; max: number },
): string {
  const todoSegment =
    incompleteCount !== null
      ? `${incompleteCount} incomplete todo${incompleteCount === 1 ? '' : 's'} remaining — `
      : '';
  const loopSegment = loopProgress
    ? `loop ${loopProgress.current}/${loopProgress.max} — `
    : '';
  return [
    `⎔ Autopilot active: ${loopSegment}${todoSegment}resuming in ${cooldownSec}s — Esc×2 to cancel`,
    '',
    '[system status: continue without acknowledging this notification]',
  ].join('\n');
}

export function buildAutopilotActiveBanner(label: 'enabled' | 'resumed'): string {
  return [
    '=== AUTOPILOT ACTIVE ===',
    label === 'enabled' ? 'Autopilot is now driving this session.' : 'Autopilot has resumed control of this session.',
  ].join('\n');
}

export function buildSuperpowersStartupGuidance(options: {
  task: string;
  maxLoops: number;
  executeStopLine: string;
  completeLine: string;
  completeStopLine: string;
  completeBehaviorLine?: string;
  delegationGuide?: string;
}): string {
  return [
    `Autopilot enabled: ${options.task}`,
    `Max loops: ${options.maxLoops}`,
    '',
    'You are Superpowers, the primary agent for this autopilot workflow.',
    'You are responsible for routing, delegation, and stop gates.',
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
    ...(options.delegationGuide ? ['', options.delegationGuide] : []),
    '',
    `Task: ${options.task}`,
  ].join('\n');
}

export function buildSuperpowersContinuationGuidance(options: {
  task: string;
  loopNumber: number;
  maxLoops: number;
  assessmentMessage: string;
  lastRecommendation: string | null;
  activeTaskVerification?: string[];
  currentPhase?: string;
}): string {
  return [
    `[Autopilot loop ${options.loopNumber}/${options.maxLoops}]`,
    `Task: ${options.task}`,
    'Continue as Superpowers.',
    ...(options.currentPhase === 'verify'
      ? ['Verification phase: confirm the active task satisfies its verification steps before advancing.']
      : ['Check whether the next step should be delegated before doing work inline.']),
    ...(options.activeTaskVerification && options.activeTaskVerification.length > 0
      ? [
          'Active task verification:',
          ...options.activeTaskVerification.map((item) => `- ${item}`),
        ]
      : []),
    ...(options.lastRecommendation
      ? [`Recommended next step: ${options.lastRecommendation}`]
      : []),
    options.assessmentMessage,
  ].join('\n');
}

export function readSuperpowersTask(projectDir: string): {
  specs: string[];
  plans: string[];
  hasSuperpowers: boolean;
} {
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const baseDir = path.join(projectDir, 'docs', 'superpowers');

    if (!fs.existsSync(baseDir)) {
      return { specs: [], plans: [], hasSuperpowers: false };
    }

    const specsDir = path.join(baseDir, 'specs');
    const plansDir = path.join(baseDir, 'plans');

    const readDir = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f: string) => f.endsWith('.md'))
        .map((f: string) => {
          const content = fs.readFileSync(path.join(dir, f), 'utf-8');
          return `### ${f}\n${content}`;
        });
    };

    const specs = readDir(specsDir);
    const plans = readDir(plansDir);

    return { specs, plans, hasSuperpowers: true };
  } catch {
    return { specs: [], plans: [], hasSuperpowers: false };
  }
}

export function readSuperpowersArtifacts(projectDir: string): {
  hasSuperpowers: boolean;
  specPaths: string[];
  planPaths: string[];
  planDocuments: ParsedPlanDocument[];
} {
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const baseDir = path.join(projectDir, 'docs', 'superpowers');

    if (!fs.existsSync(baseDir)) {
      return {
        hasSuperpowers: false,
        specPaths: [],
        planPaths: [],
        planDocuments: [],
      };
    }

    const specsDir = path.join(baseDir, 'specs');
    const plansDir = path.join(baseDir, 'plans');

    const readMarkdownPaths = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f: string) => f.endsWith('.md'))
        .sort()
        .map((f: string) => path.join(dir, f));
    };

    const specPaths = readMarkdownPaths(specsDir);
    const planPaths = readMarkdownPaths(plansDir);
    const planDocuments = planPaths.map((planPath) =>
      parsePlanMarkdown(fs.readFileSync(planPath, 'utf-8'), planPath),
    );

    return {
      hasSuperpowers: true,
      specPaths,
      planPaths,
      planDocuments,
    };
  } catch {
    return {
      hasSuperpowers: false,
      specPaths: [],
      planPaths: [],
      planDocuments: [],
    };
  }
}

export function parsePlanMarkdown(
  markdown: string,
  path = 'docs/superpowers/plans/unknown.md',
): ParsedPlanDocument {
  const lines = markdown.split(/\r?\n/);
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const tasks: ParsedPlanTask[] = [];
  let currentTask: ParsedPlanTask | null = null;
  let currentBodyLines: string[] = [];
  let currentVerification: string[] = [];
  let inVerificationSection = false;
  let taskCounter = 0;

  const flushTask = (): void => {
    if (!currentTask) {
      return;
    }

    currentTask.body = currentBodyLines.join('\n').trim();
    currentTask.verification = [...currentVerification];
    tasks.push(currentTask);
    currentTask = null;
    currentBodyLines = [];
    currentVerification = [];
    inVerificationSection = false;
  };

  for (const line of lines) {
    const checklistMatch = line.match(/^[-*]\s+\[( |x)\]\s+(.+)$/i);
    if (checklistMatch) {
      flushTask();
      taskCounter += 1;
      currentTask = {
        id: `task-${taskCounter}`,
        title: checklistMatch[2].trim(),
        body: '',
        verification: [],
        status:
          checklistMatch[1].toLowerCase() === 'x' ? 'completed' : 'pending',
      };
      continue;
    }

    const headingMatch = line.match(/^###\s+Task\s+\d+\s*:\s*(.+)$/i);
    if (headingMatch) {
      flushTask();
      taskCounter += 1;
      currentTask = {
        id: `task-${taskCounter}`,
        title: headingMatch[1].trim(),
        body: '',
        verification: [],
        status: 'pending',
      };
      continue;
    }

    if (!currentTask) {
      continue;
    }

    if (/^###\s+Verification/i.test(line) || /^\*\*Verification\*\*/i.test(line)) {
      inVerificationSection = true;
      continue;
    }

    if (/^###\s+/.test(line) && !/^###\s+Verification/i.test(line)) {
      inVerificationSection = false;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (inVerificationSection && bulletMatch) {
      currentVerification.push(bulletMatch[1].trim());
      continue;
    }

    currentBodyLines.push(line);
  }

  flushTask();

  return {
    path,
    title: titleMatch ? titleMatch[1].trim() : null,
    tasks,
  };
}

export function buildTaskContextFromSuperpowers(projectDir: string): string | null {
  const { specs, plans, hasSuperpowers } = readSuperpowersTask(projectDir);
  if (!hasSuperpowers || (specs.length === 0 && plans.length === 0)) {
    return null;
  }

  const sections: string[] = ['## Superpowers Context'];
  if (specs.length > 0) {
    sections.push('### Specs', ...specs);
  }
  if (plans.length > 0) {
    sections.push('### Plans', ...plans);
  }
  return sections.join('\n\n');
}

function unwrapQuotedTask(task: string): string {
  const trimmed = task.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseAutopilotCommand(args: string): {
  action: 'start' | 'off' | 'status' | 'resume';
  maxLoops?: number;
  task?: string;
  error?: string;
} {
  const trimmed = args.trim();

  // Empty invocation just enables autopilot — the auto-engage path handles
  // the rest on the next idle.
  if (trimmed === '') return { action: 'start' };

  if (trimmed === 'off') return { action: 'off' };
  if (trimmed === 'status') return { action: 'status' };
  if (trimmed === 'resume') return { action: 'resume' };

  const resumeLoopsMatch = trimmed.match(/^resume\s+--loops\s+(\d+)$/);
  if (resumeLoopsMatch) {
    const maxLoops = parseInt(resumeLoopsMatch[1], 10);

    if (maxLoops <= 0) {
      return { action: 'resume', error: 'maxLoops must be positive' };
    }

    return { action: 'resume', maxLoops };
  }

  // /autopilot --loops N [task...]   (task may be quoted or unquoted; optional)
  const loopsMatch = trimmed.match(/^--loops\s+(\d+)(?:\s+([\s\S]+))?$/);
  if (loopsMatch) {
    const maxLoops = parseInt(loopsMatch[1], 10);
    const rawTask = loopsMatch[2];

    if (maxLoops <= 0) {
      return { action: 'start', error: 'maxLoops must be positive' };
    }

    const task = rawTask ? unwrapQuotedTask(rawTask) : undefined;
    return task
      ? { action: 'start', maxLoops, task }
      : { action: 'start', maxLoops };
  }

  // Quoted or unquoted task — quotes are optional.
  return { action: 'start', task: unwrapQuotedTask(trimmed) };
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
  activePlanPath?: string | null;
  activeTaskTitle?: string | null;
  activeTaskStatus?: 'pending' | 'in_progress' | 'completed' | null;
  activeTaskVerificationRequired?: boolean | null;
  idleReason?: string | null;
  verifyOutcome?: 'pending' | 'failed' | 'passed' | 'issue' | null;
  lastVerifyIssueName?: string | null;
  planTaskCounts?: { completed: number; pending: number } | null;
  lastVerifiedTaskTitle?: string | null;
  lastCompletedTaskTitle?: string | null;
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
    ...(state.activeTaskTitle ? [`Current task: ${state.activeTaskTitle}`] : []),
    ...(state.activeTaskStatus ? [`Task status: ${state.activeTaskStatus}`] : []),
    ...(state.activeTaskTitle && state.activeTaskVerificationRequired !== null && state.activeTaskVerificationRequired !== undefined
      ? [`Verification required: ${state.activeTaskVerificationRequired ? 'yes' : 'no'}`]
      : []),
    ...(state.idleReason ? [`Idle reason: ${state.idleReason}`] : []),
    ...(state.verifyOutcome ? [`Verification outcome: ${state.verifyOutcome}`] : []),
    ...(state.lastVerifyIssueName ? [`Last verify issue: ${state.lastVerifyIssueName}`] : []),
    ...(state.planTaskCounts
      ? [
          `Plan progress: ${state.planTaskCounts.completed} completed, ${state.planTaskCounts.pending} pending`,
        ]
      : []),
    ...(state.lastVerifiedTaskTitle ? [`Last verified task: ${state.lastVerifiedTaskTitle}`] : []),
    ...(state.lastCompletedTaskTitle ? [`Last completed task: ${state.lastCompletedTaskTitle}`] : []),
    ...(state.activePlanPath ? [`Plan: ${state.activePlanPath}`] : []),
    `Progress: ${state.currentLoop}/${state.maxLoops} loops`,
    `Phase: ${state.currentPhase} (${state.phaseLoopCount} loops in phase)`,
  ].join('\n');
}
