import type { PluginInput } from '@opencode-ai/plugin';
import AutopilotPlugin from './index';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const ctx = {
    config: {
      autopilot: {
        defaultMaxLoops: 7,
      },
    },
    client: {
      session: {
        prompt: async () => {
          // noop for test
        },
      },
    },
  } as PluginInput & {
    config?: { autopilot?: { defaultMaxLoops?: number } };
  };

  const plugin = await AutopilotPlugin(ctx);

  assert(plugin.name === 'autopilot', 'registers autopilot plugin name');
  assert(typeof plugin.config === 'function', 'exposes config hook');
  assert(
    typeof plugin['command.execute.before'] === 'function',
    'exposes command execute hook',
  );
  assert(typeof plugin.event === 'function', 'exposes event hook');

  const opencodeConfig: Record<string, unknown> = {};
  await plugin.config?.(opencodeConfig);

  const commandConfig = opencodeConfig.command as Record<string, unknown>;
  const autopilotCommand = commandConfig.autopilot as {
    template?: string;
    description?: string;
  };

  assert(autopilotCommand.template === 'Autopilot autonomous execution', 'registers command template');
  assert(
    autopilotCommand.description ===
      'Enable autonomous multi-step execution using superpowers workflow',
    'registers command description',
  );
}

void run();
