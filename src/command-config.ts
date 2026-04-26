export const AUTOPILOT_SUPERPOWERS_PLUGIN_NAME = 'opencode-autopilot-superpowers';
export const AUTOPILOT_SUPERPOWERS_TOOL_NAME = 'autopilot';
export const AUTOPILOT_SUPERPOWERS_CONFIG_KEY = 'autopilot';
export const AUTOPILOT_SUPERPOWERS_COMMAND_NAME = 'autopilot';

export const AUTOPILOT_SUPERPOWERS_COMMAND_TEMPLATE =
  'Call the autopilot tool with raw=$ARGUMENTS';

export const AUTOPILOT_SUPERPOWERS_COMMAND_DESCRIPTION =
  'Run the /autopilot slash command for autonomous task execution';

export const AUTOPILOT_SUPERPOWERS_COMMAND_CONFIG = {
  template: AUTOPILOT_SUPERPOWERS_COMMAND_TEMPLATE,
  description: AUTOPILOT_SUPERPOWERS_COMMAND_DESCRIPTION,
  agent: 'superpowers',
} as const;
