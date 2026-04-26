export const AUTOPILOT_SUPERPOWERS_PLUGIN_NAME = 'opencode-autopilot-superpowers';
export const AUTOPILOT_SUPERPOWERS_TOOL_NAME = 'autopilot';
export const AUTOPILOT_SUPERPOWERS_CONFIG_KEY = 'autopilot';
export const AUTOPILOT_SUPERPOWERS_COMMAND_NAME = 'autopilot';

// IMPORTANT: this template is replaced inline by the `command.execute.before`
// hook before the LLM ever sees it. We keep it minimal so the user never sees
// awkward "tool dispatch" instructions in chat — just an echo of their args.
export const AUTOPILOT_SUPERPOWERS_COMMAND_TEMPLATE = '$ARGUMENTS';

export const AUTOPILOT_SUPERPOWERS_COMMAND_DESCRIPTION =
  'Run the /autopilot slash command for autonomous task execution';

export const AUTOPILOT_SUPERPOWERS_COMMAND_CONFIG = {
  template: AUTOPILOT_SUPERPOWERS_COMMAND_TEMPLATE,
  description: AUTOPILOT_SUPERPOWERS_COMMAND_DESCRIPTION,
  agent: 'superpowers',
} as const;
