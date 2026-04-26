import type { Plugin } from '@opencode-ai/plugin';
import { createAutopilotHook } from './autopilot-hook';
import type { AutopilotConfig, AutopilotHook, CommandOutput } from './types';

const AutopilotPlugin: Plugin = async (ctx) => {
  const userConfig = (ctx.config?.autopilot ?? {}) as Partial<AutopilotConfig>;
  const hook: AutopilotHook = createAutopilotHook(ctx, userConfig);

  // Import tool dynamically (ESM module)
  const { tool } = await import('@opencode-ai/plugin/tool');

  // Create autopilot tool
  const autopilotTool = tool({
    description: 'Enable autonomous multi-step execution using superpowers workflow',
    args: {
      task: tool.schema.string(),
      maxLoops: tool.schema.number().optional(),
    },
    execute: async (args: { task: string; maxLoops?: number }) => {
      // Get current session ID from context
      const sessionID = (ctx as { sessionID?: string }).sessionID;
      if (!sessionID) {
        throw new Error('Autopilot session ID is required for tool execution');
      }

      if (
        args.maxLoops !== undefined &&
        (!Number.isInteger(args.maxLoops) || args.maxLoops <= 0)
      ) {
        throw new Error('Autopilot maxLoops must be a positive integer');
      }
      
      // Call hook handler directly with structured tool args
      const output: CommandOutput = { parts: [] };
      await hook.handleToolExecute(
        { sessionID, task: args.task, maxLoops: args.maxLoops },
        output,
      );
      
      // Return response
      if (output.parts.length > 0) {
        return output.parts.map(p => p.text).join('\n');
      }

      return 'Autopilot enabled';
    },
  });

  return {
    name: 'autopilot',

    tool: {
      autopilot: autopilotTool,
    },

    config: async (opencodeConfig: Record<string, unknown>) => {
      const commandRegistry =
        opencodeConfig.command && typeof opencodeConfig.command === 'object'
          ? (opencodeConfig.command as Record<string, unknown>)
          : {};

      const existingAutopilotCommand =
        commandRegistry.autopilot && typeof commandRegistry.autopilot === 'object'
          ? (commandRegistry.autopilot as Record<string, unknown>)
          : {};

      commandRegistry.autopilot = {
        ...existingAutopilotCommand,
        description: 'Run the /autopilot slash command for autonomous task execution',
      };

      opencodeConfig.command = commandRegistry;
    },

    'command.execute.before': async (input, output) => {
      const commandInput = input as {
        command: string;
        sessionID: string;
        arguments: string;
      };

      await hook.handleCommandExecuteBefore(
        {
          ...commandInput,
          command: commandInput.command.replace(/^\//, ''),
        },
        output as CommandOutput,
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
