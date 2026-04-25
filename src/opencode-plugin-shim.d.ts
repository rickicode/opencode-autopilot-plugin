declare module '@opencode-ai/plugin' {
  export interface PluginContextConfig {
    autopilot?: Record<string, unknown>;
  }

  export interface PluginInput {
    config?: PluginContextConfig;
    client: {
      session: {
        prompt(input: {
          path: { id: string };
          body: { parts: Array<{ type: string; text?: string }> };
        }): Promise<void>;
      };
    };
  }

  export type Plugin = (
    ctx: PluginInput,
  ) => Promise<{
    name: string;
    config?: (opencodeConfig: Record<string, unknown>) => Promise<void>;
    'command.execute.before'?: (
      input: unknown,
      output: unknown,
    ) => Promise<void>;
    event?: (input: unknown) => Promise<void>;
  }>;
}
