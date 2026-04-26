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
          body: {
            noReply?: boolean;
            parts: Array<{ type: string; text?: string }>;
          };
        }): Promise<void>;
        todo(input: {
          path: { id: string };
        }): Promise<{
          data: Array<{
            id: string;
            content: string;
            status: string;
            priority: string;
          }>;
        }>;
        messages(input: {
          path: { id: string };
        }): Promise<{
          data: Array<{
            info?: { role?: string; [key: string]: unknown };
            parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
          }>;
        }>;
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

declare module '@opencode-ai/plugin/tool' {
  export const tool: {
    (options: {
      description: string;
      args: Record<string, unknown>;
      execute: (args: Record<string, unknown>) => Promise<string>;
    }): unknown;
    schema: {
      string(): unknown;
      number(): { optional(): unknown };
      boolean(): unknown;
    };
  };
}
