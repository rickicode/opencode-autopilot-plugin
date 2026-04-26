import type { Plugin } from '@opencode-ai/plugin';
import { createAutopilotHook } from './autopilot-hook';
import type { AutopilotConfig, AutopilotHook, CommandOutput } from './types';
import { buildSubagentConfigs, buildSuperpowersConfig } from './subagents';

const AUTOPILOT_COMMAND = {
  template: 'Call the autopilot tool with raw=$ARGUMENTS',
  description: 'Run the /autopilot slash command for autonomous task execution',
};

const AutopilotPlugin: Plugin = async (ctx) => {
  const userConfig = (ctx.config?.autopilot ?? {}) as Partial<AutopilotConfig>;
  const hook: AutopilotHook = createAutopilotHook(ctx, userConfig);

  // Import tool dynamically (ESM module)
  const { tool } = await import('@opencode-ai/plugin/tool');

  // Create autopilot tool
  const stringSchema = tool.schema.string() as { optional: () => unknown };
  const numberSchema = tool.schema.number() as { optional: () => unknown };
  const autopilotTool = tool({
    description: 'Enable autonomous multi-step execution using superpowers workflow',
    args: {
      task: stringSchema.optional(),
      raw: stringSchema.optional(),
      maxLoops: numberSchema.optional(),
    },
    execute: async (args: Record<string, unknown>) => {
      const typedArgs = args as { task?: string; raw?: string; maxLoops?: number };
      // Get current session ID from context
      const sessionID = (ctx as { sessionID?: string }).sessionID;
      if (!sessionID) {
        throw new Error('Autopilot session ID is required for tool execution');
      }

      if (
        typedArgs.maxLoops !== undefined &&
        (!Number.isInteger(typedArgs.maxLoops) || typedArgs.maxLoops <= 0)
      ) {
        throw new Error('Autopilot maxLoops must be a positive integer');
      }
      
      // Call hook handler directly with structured tool args
      const output: CommandOutput = { parts: [] };
      await hook.handleToolExecute(
        {
          sessionID,
          task: typedArgs.task,
          raw: typedArgs.raw,
          maxLoops: typedArgs.maxLoops,
        },
        output,
      );
      
      // Return response
      if (output.parts.length > 0) {
        return output.parts.map(p => p.text).join('\n');
      }

      return 'Autopilot enabled';
    },
  });

  const subagentConfigs = buildSubagentConfigs();
  const superpowersConfig = buildSuperpowersConfig();
  const agents = {
    superpowers: superpowersConfig,
    ...subagentConfigs,
  };

  return {
    name: 'autopilot',

    agent: agents,

    command: {
      autopilot: AUTOPILOT_COMMAND,
    },

    tool: {
      autopilot: autopilotTool,
    },

    config: async (opencodeConfig: Record<string, unknown>) => {
      // Set superpowers as default agent
      if (
        !(opencodeConfig as { default_agent?: string }).default_agent
      ) {
        (opencodeConfig as { default_agent?: string }).default_agent =
          'superpowers';
      }

      // Merge agent configs — per-agent shallow merge to preserve
      // user-supplied fields (e.g. tools, permission) from opencode.json
      if (!opencodeConfig.agent) {
        opencodeConfig.agent = { ...agents };
      } else {
        for (const [name, pluginAgent] of Object.entries(agents)) {
          const existing = (opencodeConfig.agent as Record<string, unknown>)[
            name
          ] as Record<string, unknown> | undefined;
          if (existing) {
            (opencodeConfig.agent as Record<string, unknown>)[name] = {
              ...pluginAgent,
              ...existing,
            };
          } else {
            (opencodeConfig.agent as Record<string, unknown>)[name] = {
              ...pluginAgent,
            };
          }
        }
      }

      // Register /autopilot command
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
        ...AUTOPILOT_COMMAND,
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

// OpenCode local plugin loading may use CommonJS require() against the built
// package directory, so expose the plugin function on module.exports too.
module.exports = AutopilotPlugin;
module.exports.default = AutopilotPlugin;
