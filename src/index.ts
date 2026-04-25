import type { Plugin } from '@opencode-ai/plugin';
import { createAutopilotHook } from './autopilot-hook';
import type { AutopilotConfig } from './types';

const AutopilotPlugin: Plugin = async (ctx) => {
  const userConfig = (ctx.config?.autopilot ?? {}) as Partial<AutopilotConfig>;
  const hook = createAutopilotHook(ctx, userConfig);

  return {
    name: 'autopilot',

    config: async (opencodeConfig: Record<string, unknown>) => {
      const configCommand = opencodeConfig.command as
        | Record<string, unknown>
        | undefined;

      if (!configCommand?.['autopilot']) {
        if (!opencodeConfig.command) {
          opencodeConfig.command = {};
        }

        (opencodeConfig.command as Record<string, unknown>)['autopilot'] = {
          template: 'Autopilot autonomous execution',
          description:
            'Enable autonomous multi-step execution using superpowers workflow',
        };
      }
    },

    'command.execute.before': async (input, output) => {
      await hook.handleCommandExecuteBefore(
        input as { command: string; sessionID: string; arguments: string },
        output as { parts: Array<{ type: string; text?: string }> },
      );
    },

    event: async (input) => {
      await hook.handleEvent(
        input as {
          event: { type: string; properties?: Record<string, unknown> };
        },
      );
    },
  };
};

export default AutopilotPlugin;
