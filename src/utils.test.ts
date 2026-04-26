import { createInternalPrompt, formatStatus, parseAutopilotCommand } from './utils';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

const basicTask = parseAutopilotCommand('"add auth"');
assertEqual(basicTask, { action: 'start', task: 'add auth' }, 'parses basic task');

const loopsTask = parseAutopilotCommand('--loops 15 "add auth"');
assertEqual(
  loopsTask,
  { action: 'start', maxLoops: 15, task: 'add auth' },
  'parses --loops flag',
);

const multilineTask = parseAutopilotCommand('"line one\nline two"');
assertEqual(
  multilineTask,
  { action: 'start', task: 'line one\nline two' },
  'parses multiline task input',
);

assertEqual(parseAutopilotCommand('off'), { action: 'off' }, 'parses off command');
assertEqual(
  parseAutopilotCommand('status'),
  { action: 'status' },
  'parses status command',
);
assertEqual(
  parseAutopilotCommand('resume'),
  { action: 'resume' },
  'parses resume command',
);

const invalidMaxLoops = parseAutopilotCommand('--loops 0 "task"');
if (!invalidMaxLoops.error) {
  throw new Error('rejects invalid maxLoops');
}

const malformedInput = parseAutopilotCommand('invalid');
if (!malformedInput.error) {
  throw new Error('rejects malformed input');
}

assertEqual(
  createInternalPrompt('continue'),
  { type: 'text', text: '[AUTOPILOT-INTERNAL]\ncontinue' },
  'creates internal prompt',
);

assertEqual(
  formatStatus({
    enabled: false,
    task: '',
    currentLoop: 0,
    maxLoops: 0,
    currentPhase: 'design',
    phaseLoopCount: 0,
  }),
  'Autopilot: disabled',
  'formats disabled status',
);

assertEqual(
  formatStatus({
    enabled: true,
    task: 'add auth',
    currentLoop: 2,
    maxLoops: 5,
    currentPhase: 'plan',
    phaseLoopCount: 1,
  }),
  [
    'Autopilot: enabled',
    'Task: add auth',
    'Progress: 2/5 loops',
    'Phase: plan (1 loops in phase)',
  ].join('\n'),
  'formats enabled status',
);
