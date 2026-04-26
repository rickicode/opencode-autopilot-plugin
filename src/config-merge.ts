import { copyFileSync, existsSync } from 'node:fs';

export const SUPERPOWERS_PLUGIN =
  'superpowers@git+https://github.com/obra/superpowers.git';

const MANAGED_AGENT_DEFINITIONS = {
  'autopilot-orchestrator': {
    description: 'Autopilot managed orchestrator agent',
    metadata: { owner: 'autopilot' },
    mode: 'primary',
  },
  'autopilot-explorer': {
    description: 'Autopilot managed explorer agent',
    metadata: { owner: 'autopilot' },
    mode: 'delegated',
  },
  'autopilot-implementer': {
    description: 'Autopilot managed implementer agent',
    metadata: { owner: 'autopilot' },
    mode: 'delegated',
  },
  'autopilot-knowledge': {
    description: 'Autopilot managed knowledge agent',
    metadata: { owner: 'autopilot' },
    mode: 'delegated',
  },
  'autopilot-designer': {
    description: 'Autopilot managed designer agent',
    metadata: { owner: 'autopilot' },
    mode: 'delegated',
  },
  'autopilot-reviewer': {
    description: 'Autopilot managed reviewer agent',
    metadata: { owner: 'autopilot' },
    mode: 'delegated',
  },
} as const;

export const MANAGED_AUTOPILOT_AGENT_IDS = Object.keys(MANAGED_AGENT_DEFINITIONS);
type ManagedAutopilotAgentID = keyof typeof MANAGED_AGENT_DEFINITIONS;
export const MANAGED_AUTOPILOT_AGENT_KEYS = Object.keys(
  MANAGED_AGENT_DEFINITIONS,
) as ManagedAutopilotAgentID[];

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

export function mergeOpenCodeConfig(existing: Record<string, any>): {
  config: Record<string, any>;
  conflicts: string[];
} {
  const config = cloneConfig(existing);
  const conflicts: string[] = [];

  if (config.plugin === undefined) {
    config.plugin = [SUPERPOWERS_PLUGIN];
  } else if (Array.isArray(config.plugin)) {
    const plugin = [...config.plugin];
    if (!plugin.includes(SUPERPOWERS_PLUGIN)) {
      plugin.push(SUPERPOWERS_PLUGIN);
    }
    config.plugin = plugin;
  } else {
    conflicts.push('plugin');
  }

  if (config.agent !== undefined && !isObjectRecord(config.agent)) {
    conflicts.push('agent');
  } else {
    const agent = isObjectRecord(config.agent) ? { ...config.agent } : {};

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

  const desiredDefaultAgent = 'autopilot-orchestrator';
  if (config.default_agent === undefined) {
    config.default_agent = desiredDefaultAgent;
  } else if (config.default_agent !== desiredDefaultAgent) {
    conflicts.push('default_agent');
  }

  return { config, conflicts };
}
