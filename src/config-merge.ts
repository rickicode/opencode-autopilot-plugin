import { copyFileSync, existsSync } from 'node:fs';
import { AUTOPILOT_COMMAND_CONFIG } from './command-config';

export const SUPERPOWERS_PLUGIN =
  'superpowers@git+https://github.com/obra/superpowers.git';

export function getLocalAutopilotPluginEntry(baseDir: string = process.cwd()): string {
  return baseDir;
}

const MANAGED_AGENT_DEFINITIONS = {
  superpowers: {
    description: 'Autopilot managed Superpowers primary agent',
    metadata: { owner: 'autopilot' },
    mode: 'primary',
  },
  'superpowers-explorer': {
    description: 'Autopilot managed explorer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-implementer': {
    description: 'Autopilot managed implementer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-knowledge': {
    description: 'Autopilot managed knowledge agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-designer': {
    description: 'Autopilot managed designer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
  'superpowers-reviewer': {
    description: 'Autopilot managed reviewer agent',
    metadata: { owner: 'autopilot' },
    mode: 'subagent',
  },
} as const;

export const MANAGED_AUTOPILOT_AGENT_IDS = Object.keys(MANAGED_AGENT_DEFINITIONS);
type ManagedAutopilotAgentID = keyof typeof MANAGED_AGENT_DEFINITIONS;
export const MANAGED_AUTOPILOT_AGENT_KEYS = Object.keys(
  MANAGED_AGENT_DEFINITIONS,
) as ManagedAutopilotAgentID[];

const LEGACY_AGENT_ID_MIGRATIONS = {
  'autopilot-superpowers': 'superpowers',
  'autopilot-explorer': 'superpowers-explorer',
  'autopilot-implementer': 'superpowers-implementer',
  'autopilot-knowledge': 'superpowers-knowledge',
  'autopilot-designer': 'superpowers-designer',
  'autopilot-reviewer': 'superpowers-reviewer',
} as const;

type LegacyAutopilotAgentID = keyof typeof LEGACY_AGENT_ID_MIGRATIONS;
const LEGACY_AUTOPILOT_AGENT_KEYS = Object.keys(
  LEGACY_AGENT_ID_MIGRATIONS,
) as LegacyAutopilotAgentID[];

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function isObjectRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAutopilotOwnedAgent(value: unknown): value is Record<string, any> {
  return isObjectRecord(value)
    && isObjectRecord(value.metadata)
    && value.metadata.owner === 'autopilot';
}

function getUniqueBackupPath(configPath: string): string {
  const defaultBackupPath = `${configPath}.bak`;
  if (!existsSync(defaultBackupPath)) {
    return defaultBackupPath;
  }

  let index = 1;
  let candidatePath = `${defaultBackupPath}.${index}`;
  while (existsSync(candidatePath)) {
    index += 1;
    candidatePath = `${defaultBackupPath}.${index}`;
  }

  return candidatePath;
}

function mergeManagedAgent(
  existingAgent: Record<string, any>,
  managedDefinition: Record<string, any>,
): Record<string, any> {
  return {
    ...existingAgent,
    ...managedDefinition,
    metadata: {
      ...(isObjectRecord(existingAgent.metadata) ? existingAgent.metadata : {}),
      ...(isObjectRecord(managedDefinition.metadata) ? managedDefinition.metadata : {}),
      owner: 'autopilot',
    },
  };
}

export function backupConfigFile(configPath: string): string {
  const backupPath = getUniqueBackupPath(configPath);
  copyFileSync(configPath, backupPath);
  return backupPath;
}

export function mergeOpenCodeConfig(
  existing: Record<string, any>,
  localAutopilotPlugin: string = getLocalAutopilotPluginEntry(),
): {
  config: Record<string, any>;
  conflicts: string[];
} {
  const config = cloneConfig(existing);
  const conflicts: string[] = [];

  if (config.plugin === undefined) {
    config.plugin = [SUPERPOWERS_PLUGIN, localAutopilotPlugin];
  } else if (Array.isArray(config.plugin)) {
    const plugin = [...config.plugin];
    if (!plugin.includes(SUPERPOWERS_PLUGIN)) {
      plugin.push(SUPERPOWERS_PLUGIN);
    }
    if (!plugin.includes(localAutopilotPlugin)) {
      plugin.push(localAutopilotPlugin);
    }
    config.plugin = plugin;
  } else {
    conflicts.push('plugin');
  }

  if (config.agent !== undefined && !isObjectRecord(config.agent)) {
    conflicts.push('agent');
  } else {
    const agent = isObjectRecord(config.agent) ? { ...config.agent } : {};

    for (const legacyAgentID of LEGACY_AUTOPILOT_AGENT_KEYS) {
      const canonicalAgentID = LEGACY_AGENT_ID_MIGRATIONS[legacyAgentID];
      const legacyAgent = agent[legacyAgentID];

      if (legacyAgent === undefined || !isAutopilotOwnedAgent(legacyAgent)) {
        continue;
      }

      if (agent[canonicalAgentID] === undefined) {
        agent[canonicalAgentID] = legacyAgent;
      }

      delete agent[legacyAgentID];
    }

    for (const agentID of MANAGED_AUTOPILOT_AGENT_KEYS) {
      const managedDefinition = cloneConfig(MANAGED_AGENT_DEFINITIONS[agentID]);
      const existingAgent = agent[agentID];

      if (existingAgent === undefined) {
        agent[agentID] = managedDefinition;
        continue;
      }

      if (isAutopilotOwnedAgent(existingAgent)) {
        agent[agentID] = mergeManagedAgent(existingAgent, managedDefinition);
        continue;
      }

      if (!conflicts.includes(`agent.${agentID}`)) {
        conflicts.push(`agent.${agentID}`);
      }
    }

    config.agent = agent;
  }

  if (config.command !== undefined && !isObjectRecord(config.command)) {
    conflicts.push('command');
  } else {
    const command = isObjectRecord(config.command) ? { ...config.command } : {};
    const existingAutopilotCommand = command.autopilot;

    command.autopilot = isObjectRecord(existingAutopilotCommand)
      ? {
          ...existingAutopilotCommand,
          ...AUTOPILOT_COMMAND_CONFIG,
        }
      : {
          ...AUTOPILOT_COMMAND_CONFIG,
        };

    config.command = command;
  }

  const desiredDefaultAgent = 'superpowers';
  if (config.default_agent === undefined) {
    config.default_agent = desiredDefaultAgent;
  } else if (config.default_agent === 'autopilot-superpowers') {
    config.default_agent = desiredDefaultAgent;
  } else if (config.default_agent !== desiredDefaultAgent) {
    conflicts.push('default_agent');
  }

  return { config, conflicts };
}
