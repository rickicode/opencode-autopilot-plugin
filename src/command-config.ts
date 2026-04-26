export const AUTOPILOT_COMMAND_NAME = 'autopilot';

export const AUTOPILOT_COMMAND_TEMPLATE =
  'Call the autopilot tool with raw=$ARGUMENTS';

export const AUTOPILOT_COMMAND_DESCRIPTION =
  'Run the /autopilot slash command for autonomous task execution';

export const AUTOPILOT_COMMAND_CONFIG = {
  template: AUTOPILOT_COMMAND_TEMPLATE,
  description: AUTOPILOT_COMMAND_DESCRIPTION,
  agent: 'superpowers',
} as const;
