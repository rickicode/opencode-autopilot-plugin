declare module '@opencode-ai/plugin' {
  export interface PluginInput {
    client: {
      session: {
        prompt(input: {
          path: { id: string };
          body: { parts: Array<{ type: string; text?: string }> };
        }): Promise<void>;
      };
    };
  }
}
