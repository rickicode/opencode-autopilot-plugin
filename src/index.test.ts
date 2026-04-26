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
    body: { noReply?: boolean; parts: Array<{ type: string; text?: string }> };
  }> = [];

  const ctx = {
    sessionID: 'session-1',
    config: {
      autopilot: {
        defaultMaxLoops: 7,
        maxLoopsPerPhase: 5,
        cooldownMs: 0,
        questionDetection: false,
        todoAware: false,
      },
    },
    client: {
      session: {
        prompt: async (input: {
          path: { id: string };
          body: { noReply?: boolean; parts: Array<{ type: string; text?: string }> };
        }) => {
          prompts.push(input);
        },
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [] }),
      },
    },
  } as PluginInput & {
    config?: {
      autopilot?: {
        defaultMaxLoops?: number;
        maxLoopsPerPhase?: number;
        cooldownMs?: number;
        questionDetection?: boolean;
        todoAware?: boolean;
      };
    };
  };

  const plugin = (await AutopilotPlugin(ctx)) as {
    name: string;
    agent?: Record<string, unknown>;
    command?: Record<string, unknown>;
    tool?: Record<string, unknown>;
    'command.execute.before'?: (input: unknown, output: unknown) => Promise<void>;
    config?: (opencodeConfig: Record<string, unknown>) => Promise<void>;
    event?: (input: unknown) => Promise<void>;
  };
  const toolRegistry = plugin.tool as Record<string, unknown>;
  const autopilotTool = toolRegistry.autopilot as {
    description?: string;
    execute?: (args: { task?: string; raw?: string; maxLoops?: number }) => Promise<string>;
  };

  assert(
    plugin.name === 'opencode-autopilot-superpowers',
    'registers opencode-autopilot-superpowers plugin name',
  );
  assert(typeof plugin.config === 'function', 'exposes config hook');
  assert(typeof plugin.command === 'object', 'exposes plugin command registry');
  assert(typeof autopilotTool === 'object', 'registers autopilot tool');
  assert(typeof autopilotTool.execute === 'function', 'exposes autopilot tool execute');
  assert(
    typeof plugin['command.execute.before'] === 'function',
    'exposes command execute before hook',
  );
  assert(typeof plugin.event === 'function', 'exposes event hook');

  const pluginCommandRegistry = (plugin.command ?? {}) as Record<string, unknown>;
  const pluginAutopilotCommand =
    (pluginCommandRegistry.autopilot ?? {}) as Record<string, unknown>;
  assert(
    pluginAutopilotCommand.template === 'Call the autopilot tool with raw=$ARGUMENTS',
    'plugin directly exposes slim-style autopilot command template for runtime registration',
  );
  assert(
    pluginAutopilotCommand.agent === 'superpowers',
    'plugin directly routes /autopilot through the superpowers primary agent',
  );
  assert(
    typeof pluginAutopilotCommand.description === 'string' &&
      pluginAutopilotCommand.description.includes('/autopilot'),
    'plugin directly exposes autopilot command description for runtime registration',
  );

  // The built plugin is emitted as CommonJS; local OpenCode loading must still
  // be able to reach the plugin function through the default export shape.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const commonJsLoaded = require('./index') as {
    default?: unknown;
  };
  assert(
    typeof commonJsLoaded.default === 'function',
    'commonjs loader also exposes default export compatibility',
  );

  // Agent registration
  assert(typeof plugin.agent === 'object', 'registers agent configs');
  const agentRegistry = plugin.agent as Record<string, Record<string, unknown>>;
  assert(agentRegistry.superpowers !== undefined, 'registers superpowers agent');
  assert(
    (agentRegistry.superpowers as { mode?: string }).mode === 'primary',
    'superpowers is primary mode',
  );
  const expectedSubagents = [
    'superpowers-explorer',
    'superpowers-knowledge',
    'superpowers-designer',
    'superpowers-implementer',
    'superpowers-reviewer',
  ];
  for (const name of expectedSubagents) {
    assert(agentRegistry[name] !== undefined, `registers ${name} subagent`);
    assert(
      (agentRegistry[name] as { mode?: string }).mode === 'subagent',
      `${name} is subagent mode`,
    );
  }

  const opencodeConfig: Record<string, unknown> = {};
  await plugin.config?.(opencodeConfig);
  const commandRegistry = (opencodeConfig.command ?? {}) as Record<string, unknown>;
  const autopilotCommand = (commandRegistry.autopilot ?? {}) as Record<string, unknown>;

  assert(typeof commandRegistry === 'object', 'config hook initializes command registry');
  assert(typeof autopilotCommand === 'object', 'config hook registers autopilot command');
  assert(
    autopilotCommand.template === 'Call the autopilot tool with raw=$ARGUMENTS',
    'config hook preserves slim-style slash-command template for autopilot discovery',
  );
  assert(
    autopilotCommand.agent === 'superpowers',
    'config hook routes slash-command fallback through superpowers',
  );
  assert(
    typeof autopilotCommand.description === 'string' &&
      autopilotCommand.description.includes('/autopilot'),
    'config hook registers slash-command description for autopilot',
  );

  assert(
    commandRegistry['autopilot-superpowers'] === undefined,
    'config hook does not register a renamed slash command alias',
  );
  assert(
    toolRegistry['autopilot-superpowers'] === undefined,
    'plugin does not register a renamed tool alias',
  );

  // Config hook sets default_agent
  assert(
    (opencodeConfig as { default_agent?: string }).default_agent === 'superpowers',
    'config hook sets superpowers as default agent',
  );

  // Config hook merges agent configs
  const mergedAgents = opencodeConfig.agent as Record<string, unknown>;
  assert(mergedAgents !== undefined, 'config hook merges agents into opencodeConfig');
  assert(mergedAgents.superpowers !== undefined, 'config hook includes superpowers agent');
  for (const name of expectedSubagents) {
    assert(mergedAgents[name] !== undefined, `config hook includes ${name} agent`);
  }

  // Config hook preserves existing user agents
  const configWithExisting: Record<string, unknown> = {
    agent: { 'custom-agent': { prompt: 'user-custom' } },
  };
  await plugin.config?.(configWithExisting);
  const mergedWithExisting = configWithExisting.agent as Record<string, Record<string, unknown>>;
  assert(
    mergedWithExisting['custom-agent']?.prompt === 'user-custom',
    'config hook preserves existing user agents',
  );
  assert(
    mergedWithExisting.superpowers !== undefined,
    'config hook adds superpowers alongside existing agents',
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
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [] }),
      },
    },
  } as PluginInput;
  const missingSessionPlugin = (await AutopilotPlugin(missingSessionCtx)) as {
    tool?: Record<string, unknown>;
  };
  const missingSessionTool = missingSessionPlugin.tool?.autopilot as {
    execute?: (args: { task?: string; raw?: string; maxLoops?: number }) => Promise<string>;
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

  const rawStatusResult = await autopilotTool.execute?.({ raw: 'status' });
  assert(
    rawStatusResult?.includes('Autopilot: enabled'),
    'tool execution accepts raw command arguments for status fallback',
  );
}

void run();
