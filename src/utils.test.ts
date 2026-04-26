import {
  createInternalPrompt,
  formatStatus,
  parseAutopilotCommand,
  parsePlanMarkdown,
  isQuestion,
  countIncompleteTodos,
  buildCountdownNotification,
  readSuperpowersTask,
  buildTaskContextFromSuperpowers,
} from './utils';

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
assertEqual(
  parseAutopilotCommand('resume --loops 8'),
  { action: 'resume', maxLoops: 8 },
  'parses resume command with loop override',
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
    activeTaskTitle: 'Implement login flow',
    activeTaskStatus: 'in_progress',
    activeTaskVerificationRequired: true,
    idleReason: 'verify_issue',
    verifyOutcome: 'issue',
    lastVerifyIssueName: 'ToolUnavailableError',
    planTaskCounts: { completed: 1, pending: 2 },
    lastVerifiedTaskTitle: 'Prepare fixtures',
    lastCompletedTaskTitle: 'Prepare fixtures',
    currentLoop: 2,
    maxLoops: 5,
    currentPhase: 'plan',
    phaseLoopCount: 1,
  }),
  [
    'Autopilot: enabled',
    'Task: add auth',
    'Current task: Implement login flow',
    'Task status: in_progress',
    'Verification required: yes',
    'Idle reason: verify_issue',
    'Verification outcome: issue',
    'Last verify issue: ToolUnavailableError',
    'Plan progress: 1 completed, 2 pending',
    'Last verified task: Prepare fixtures',
    'Last completed task: Prepare fixtures',
    'Progress: 2/5 loops',
    'Phase: plan (1 loops in phase)',
  ].join('\n'),
  'formats enabled status',
);

// isQuestion tests
function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(isQuestion('Would you like me to proceed?'), 'detects trailing question mark');
assert(isQuestion('Should I deploy this?'), 'detects question mark at end');
assert(isQuestion('would you like to review this'), 'detects question phrase: would you like');
assert(isQuestion('Should I continue?'), 'detects question phrase: should i');
assert(isQuestion('Do you want me to fix this?'), 'detects question phrase: do you want');
assert(isQuestion('Let me know if you have questions'), 'detects question phrase: let me know');
assert(isQuestion('SHALL I proceed'), 'detects question phrase case-insensitively');
assert(!isQuestion('I have completed the task.'), 'does not flag statements');
assert(!isQuestion('All tests pass successfully'), 'does not flag success messages');
assert(!isQuestion(''), 'does not flag empty string');
assert(!isQuestion('I should investigate this further'), 'does not false-positive on should+i across word boundary');
assert(!isQuestion('We shall implement this now'), 'does not false-positive on shall+i across word boundary');

// countIncompleteTodos tests
assertEqual(
  countIncompleteTodos([
    { status: 'completed' },
    { status: 'pending' },
    { status: 'in_progress' },
    { status: 'cancelled' },
  ]),
  2,
  'counts non-terminal todos as incomplete',
);
assertEqual(
  countIncompleteTodos([
    { status: 'completed' },
    { status: 'cancelled' },
  ]),
  0,
  'returns 0 when all todos are terminal',
);
assertEqual(countIncompleteTodos([]), 0, 'returns 0 for empty array');

// buildCountdownNotification tests
const notification = buildCountdownNotification(3, 3);
assert(notification.includes('⎔ Autopilot:'), 'notification contains autopilot marker');
assert(notification.includes('3 incomplete todos remaining'), 'notification shows todo count');
assert(notification.includes('3s'), 'notification shows cooldown seconds');
assert(notification.includes('Esc×2 to cancel'), 'notification mentions escape to cancel');

// Pluralization: singular
const singularNotification = buildCountdownNotification(1, 3);
assert(singularNotification.includes('1 incomplete todo remaining'), 'singular: uses todo not todos');
assert(!singularNotification.includes('todos'), 'singular: does not contain todos');

// Null count (todoAware=false)
const nullNotification = buildCountdownNotification(null, 3);
assert(!nullNotification.includes('incomplete'), 'null count omits todo segment');
assert(nullNotification.includes('resuming in 3s'), 'null count still shows cooldown');

// readSuperpowersTask tests
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const emptyDir = mkdtempSync(join(tmpdir(), 'autopilot-no-sp-'));
const noSpResult = readSuperpowersTask(emptyDir);
assertEqual(noSpResult.hasSuperpowers, false, 'returns hasSuperpowers=false when dir missing');
assertEqual(noSpResult.specs.length, 0, 'returns empty specs when dir missing');
assertEqual(noSpResult.plans.length, 0, 'returns empty plans when dir missing');

const spDir = mkdtempSync(join(tmpdir(), 'autopilot-sp-'));
const specsDir = join(spDir, 'docs', 'superpowers', 'specs');
const plansDir = join(spDir, 'docs', 'superpowers', 'plans');
mkdirSync(specsDir, { recursive: true });
mkdirSync(plansDir, { recursive: true });
writeFileSync(join(specsDir, 'auth.md'), '# Auth Spec\nJWT auth flow');
writeFileSync(join(plansDir, 'auth-plan.md'), '# Auth Plan\nStep 1: Add JWT');

const spResult = readSuperpowersTask(spDir);
assertEqual(spResult.hasSuperpowers, true, 'detects superpowers directory');
assertEqual(spResult.specs.length, 1, 'reads spec files');
assertEqual(spResult.plans.length, 1, 'reads plan files');
assert(spResult.specs[0].includes('Auth Spec'), 'spec content includes file content');
assert(spResult.plans[0].includes('Auth Plan'), 'plan content includes file content');

// buildTaskContextFromSuperpowers tests
const noContext = buildTaskContextFromSuperpowers(emptyDir);
assertEqual(noContext, null, 'returns null when no superpowers');

const context = buildTaskContextFromSuperpowers(spDir);
assert(context !== null, 'returns context when superpowers exists');
assert(context!.includes('Superpowers Context'), 'context includes header');
assert(context!.includes('Auth Spec'), 'context includes spec content');
assert(context!.includes('Auth Plan'), 'context includes plan content');

const checklistPlan = parsePlanMarkdown(`# Sample Plan

- [ ] Add readiness split
Implementation notes here.

### Verification
- npm test

- [x] Update docs
Docs notes.
`);

assertEqual(checklistPlan.title, 'Sample Plan', 'parses markdown plan title');
assertEqual(checklistPlan.tasks.length, 2, 'parses checklist tasks');
assertEqual(checklistPlan.tasks[0].id, 'task-1', 'assigns sequential task ids');
assertEqual(checklistPlan.tasks[0].title, 'Add readiness split', 'parses checklist title');
assertEqual(checklistPlan.tasks[0].status, 'pending', 'unchecked checklist task is pending');
assert(
  checklistPlan.tasks[0].body.includes('Implementation notes here.'),
  'preserves checklist task body',
);
assertEqual(checklistPlan.tasks[0].verification, ['npm test'], 'collects verification bullets');
assertEqual(checklistPlan.tasks[1].status, 'completed', 'checked checklist task is completed');

const headingPlan = parsePlanMarkdown(`### Task 1: Add parser
Use a minimal parser.

### Verification
- node --test

### Task 2: Wire state
Track active task.
`);

assertEqual(headingPlan.tasks.length, 2, 'parses heading-based tasks');
assertEqual(headingPlan.tasks[0].title, 'Add parser', 'parses heading task title');
assertEqual(headingPlan.tasks[0].verification, ['node --test'], 'captures heading verification');
