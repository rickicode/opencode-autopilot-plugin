import type { PluginInput } from '@opencode-ai/plugin';
import { createAutopilotHook } from './autopilot-hook';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
    );
  }
}

async function run(): Promise<void> {
  const prompts: Array<{
    path: { id: string };
    body: { parts: Array<{ type: string; text?: string }> };
  }> = [];

  const ctx = {
    client: {
      session: {
        prompt: async (input: {
          path: { id: string };
          body: { parts: Array<{ type: string; text?: string }> };
        }) => {
          prompts.push(input);
        },
      },
    },
  } as PluginInput;

  const hook = createAutopilotHook(ctx, {
    defaultMaxLoops: 3,
    maxLoopsPerPhase: 2,
    cooldownMs: 0,
  });

  const nonAutopilotOutput = { parts: [{ type: 'text', text: 'keep me' }] };
  await hook.handleCommandExecuteBefore(
    { command: 'other', sessionID: 'session-1', arguments: '' },
    nonAutopilotOutput,
  );
  assertEqual(nonAutopilotOutput.parts, [{ type: 'text', text: 'keep me' }], 'ignores other commands');

  const startOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: '"build plugin"' },
    startOutput,
  );
  assert(startOutput.parts[0]?.text?.includes('Autopilot enabled: build plugin'), 'starts autopilot');
  assert(startOutput.parts[0]?.text?.includes('You are the superpowers agent.'), 'includes execution instructions');

  const statusOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'status' },
    statusOutput,
  );
  assertEqual(
    statusOutput.parts[0]?.text,
    [
      '[AUTOPILOT-INTERNAL]',
      'Autopilot: enabled',
      'Task: build plugin',
      'Progress: 0/3 loops',
      'Phase: design (0 loops in phase)',
    ].join('\n'),
    'reports enabled status',
  );

  await hook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-1' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(prompts.length, 1, 'sends continuation prompt on idle');
  assert(
    prompts[0]?.body.parts[0]?.text?.includes('[Autopilot loop 1/3] Continue with next step.'),
    'continuation prompt includes next loop message',
  );

  const resumedStatusOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'status' },
    resumedStatusOutput,
  );
  assert(
    resumedStatusOutput.parts[0]?.text?.includes('Progress: 1/3 loops'),
    'idle continuation increments loop count',
  );

  const offOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-1', arguments: 'off' },
    offOutput,
  );
  assertEqual(
    offOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nAutopilot disabled.',
    'disables autopilot',
  );

  const resumeMissingOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await hook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-2', arguments: 'resume' },
    resumeMissingOutput,
  );
  assertEqual(
    resumeMissingOutput.parts[0]?.text,
    '[AUTOPILOT-INTERNAL]\nNo previous autopilot session to resume.',
    'rejects resume without prior task',
  );

  const limitedHook = createAutopilotHook(ctx, {
    defaultMaxLoops: 1,
    maxLoopsPerPhase: 5,
    cooldownMs: 0,
  });
  const limitedStartOutput = { parts: [] as Array<{ type: string; text?: string }> };
  await limitedHook.handleCommandExecuteBefore(
    { command: 'autopilot', sessionID: 'session-3', arguments: '"ship feature"' },
    limitedStartOutput,
  );
  await limitedHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-3' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await limitedHook.handleEvent({
    event: { type: 'session.idle', properties: { sessionID: 'session-3' } },
  });

  assertEqual(prompts.length, 3, 'sends stop prompt after max loops');
  assert(
    prompts[2]?.body.parts[0]?.text?.includes('Autopilot stopped: reached max loops (1).'),
    'stops when max loops reached',
  );
}

void run();
