import type { PluginInput } from '@opencode-ai/plugin';
import AutopilotPlugin from './index';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const prompts: Array<{
    path: { id: string };
    body: { parts: Array<{ type: string; text?: string }> };
  }> = [];

  const ctx = {
    sessionID: 'session-1',
    config: {
      autopilot: {
        defaultMaxLoops: 7,
        maxLoopsPerPhase: 5,
        cooldownMs: 0,
      },
    },
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
  } as PluginInput & {
    config?: {
      autopilot?: {
        defaultMaxLoops?: number;
        maxLoopsPerPhase?: number;
        cooldownMs?: number;
      };
    };
  };

  const plugin = (await AutopilotPlugin(ctx)) as {
    name: string;
    tool?: Record<string, unknown>;
    'command.execute.before'?: (input: unknown, output: unknown) => Promise<void>;
    config?: (opencodeConfig: Record<string, unknown>) => Promise<void>;
    event?: (input: unknown) => Promise<void>;
  };
  const toolRegistry = plugin.tool as Record<string, unknown>;
  const autopilotTool = toolRegistry.autopilot as {
    description?: string;
    execute?: (args: { task: string; maxLoops?: number }) => Promise<string>;
  };

  assert(plugin.name === 'autopilot', 'registers autopilot plugin name');
  assert(typeof plugin.config === 'function', 'exposes config hook');
  assert(typeof autopilotTool === 'object', 'registers autopilot tool');
  assert(typeof autopilotTool.execute === 'function', 'exposes autopilot tool execute');
  assert(
    typeof plugin['command.execute.before'] === 'function',
    'exposes command execute before hook',
  );
  assert(typeof plugin.event === 'function', 'exposes event hook');

  const opencodeConfig: Record<string, unknown> = {};
  await plugin.config?.(opencodeConfig);
  const commandRegistry = (opencodeConfig.command ?? {}) as Record<string, unknown>;
  const autopilotCommand = (commandRegistry.autopilot ?? {}) as Record<string, unknown>;

  assert(typeof commandRegistry === 'object', 'config hook initializes command registry');
  assert(typeof autopilotCommand === 'object', 'config hook registers autopilot command');
  assert(
    typeof autopilotCommand.description === 'string' &&
      autopilotCommand.description.includes('/autopilot'),
    'config hook registers slash-command description for autopilot',
  );
  assert(
    autopilotTool.description ===
      'Enable autonomous multi-step execution using superpowers workflow',
    'registers tool description',
  );

  const toolResult = await autopilotTool.execute?.({
    task: 'build plugin',
    maxLoops: 2,
  });
  assert(
    toolResult?.includes('Autopilot enabled: build plugin'),
    'tool execution forwards to autopilot hook',
  );

  await plugin.event?.({
    event: { type: 'session.idle', properties: { sessionID: 'session-1' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(prompts.length === 1, 'tool-start path sends continuation prompt on idle');
  assert(
    prompts[0]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'tool-start path continues with recommendation prompt',
  );

  const commandOutput = { parts: [{ type: 'text', text: 'stale' }] };
  await plugin['command.execute.before']?.(
    { command: '/autopilot', sessionID: 'session-2', arguments: '"build plugin"' },
    commandOutput,
  );
  assert(
    commandOutput.parts[0]?.text?.includes('Autopilot enabled: build plugin'),
    'command hook forwards autopilot start',
  );

  await plugin.event?.({
    event: { type: 'session.idle', properties: { sessionID: 'session-2' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(prompts.length === 2, 'command-start path sends continuation prompt on idle');
  assert(
    prompts[1]?.path.id === 'session-2' &&
      prompts[1]?.body.parts[0]?.text?.includes('Continue using the previous recommendation:'),
    'command-start path continues with recommendation prompt',
  );

  let invalidLoopError: unknown;
  try {
    await autopilotTool.execute?.({
      task: 'build plugin',
      maxLoops: 0,
    });
  } catch (error) {
    invalidLoopError = error;
  }

  assert(
    invalidLoopError instanceof Error &&
      invalidLoopError.message.includes('maxLoops must be a positive integer'),
    'tool rejects non-positive maxLoops values',
  );

  const multilineResult = await autopilotTool.execute?.({
    task: 'build plugin\nthen verify',
  });
  assert(
    multilineResult?.includes('Autopilot enabled: build plugin\nthen verify'),
    'tool execution preserves multiline tasks',
  );

  const missingSessionCtx = {
    client: {
      session: {
        prompt: async () => {
          // noop for test
        },
      },
    },
  } as PluginInput;
  const missingSessionPlugin = (await AutopilotPlugin(missingSessionCtx)) as {
    tool?: Record<string, unknown>;
  };
  const missingSessionTool = missingSessionPlugin.tool?.autopilot as {
    execute?: (args: { task: string; maxLoops?: number }) => Promise<string>;
  };

  let missingSessionError: unknown;
  try {
    await missingSessionTool.execute?.({ task: 'build plugin' });
  } catch (error) {
    missingSessionError = error;
  }

  assert(
    missingSessionError instanceof Error &&
      missingSessionError.message.includes('session ID is required'),
    'tool rejects execution without a session ID',
  );
}

void run();
