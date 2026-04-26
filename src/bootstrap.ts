import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  mergeOpenCodeConfig,
  backupConfigFile,
  getLocalAutopilotPluginEntry,
  SUPERPOWERS_PLUGIN,
} from './config-merge';
import { evaluateReadiness } from './readiness';

export interface BootstrapOptions {
  dryRun?: boolean;
  configPath: string;
}

export interface BootstrapResult {
  steps: string[];
  nextCommand: string;
  backupPath?: string;
  readiness: ReturnType<typeof evaluateReadiness>;
  conflicts: string[];
}

const BOOTSTRAP_STEPS = [
  'detect-opencode',
  'backup-config',
  'ensure-superpowers',
  'install-autopilot',
  'provision-agents',
  'validate-readiness',
] as const;

const AUTOPILOT_COMMAND_FILE = `---
description: Run the /autopilot slash command for autonomous task execution
---
Call the autopilot tool with raw=$ARGUMENTS
`;

class BootstrapError extends Error {
  constructor(
    readonly code:
      | 'CONFIG_NOT_FOUND'
      | 'CONFIG_INVALID_JSON'
      | 'CONFIG_READ_FAILED'
      | 'CONFIG_WRITE_FAILED'
      | 'CONFIG_VERIFY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildApplyCommand(configPath: string): string {
  return `OPENCODE_CONFIG_PATH=${shellQuote(configPath)} npm run bootstrap:install`;
}

function buildVerifyCommand(configPath: string): string {
  return `OPENCODE_CONFIG_PATH=${shellQuote(configPath)} npm run readiness:check`;
}

function buildNextCommand(configPath: string, dryRun: boolean): string {
  return dryRun
    ? `Apply for real: ${buildApplyCommand(configPath)}`
    : `Verify installation: ${buildVerifyCommand(configPath)}`;
}

export function getReadinessFromConfig(config: Record<string, any>) {
  const pluginEntries = Array.isArray(config.plugin) ? config.plugin : [];
  const localAutopilotPlugin = getLocalAutopilotPluginEntry();
  const availableAgents =
    config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)
      ? Object.keys(config.agent)
      : [];

  return evaluateReadiness({
    configReadable: true,
    superpowersDeclared: pluginEntries.some(
      (entry) => entry === SUPERPOWERS_PLUGIN,
    ),
    autopilotInstalled:
      pluginEntries.some((entry) => entry === localAutopilotPlugin)
      && availableAgents.includes('superpowers'),
    availableAgents,
  });
}

export function readCurrentReadiness(configPath: string): {
  steps: string[];
  readiness: ReturnType<typeof evaluateReadiness>;
} {
  try {
    const config = readConfigForBootstrap(configPath);

    return {
      steps: [...BOOTSTRAP_STEPS],
      readiness: getReadinessFromConfig(config),
    };
  } catch (error) {
    if (error instanceof BootstrapError) {
      return {
        steps: [...BOOTSTRAP_STEPS],
        readiness: getUnreadableReadiness(),
      };
    }

    throw error;
  }
}

function getUnreadableReadiness() {
  return evaluateReadiness({
    configReadable: false,
    superpowersDeclared: false,
    autopilotInstalled: false,
    availableAgents: [],
  });
}

function readConfigForBootstrap(configPath: string): Record<string, any> {
  if (!existsSync(configPath)) {
    throw new BootstrapError(
      'CONFIG_NOT_FOUND',
      `OpenCode config was not found at "${configPath}".`,
    );
  }

  let rawConfig: string;
  try {
    rawConfig = readFileSync(configPath, 'utf8');
  } catch {
    throw new BootstrapError(
      'CONFIG_READ_FAILED',
      `Unable to read OpenCode config at "${configPath}".`,
    );
  }

  try {
    return JSON.parse(rawConfig) as Record<string, any>;
  } catch {
    throw new BootstrapError(
      'CONFIG_INVALID_JSON',
      `OpenCode config at "${configPath}" contains invalid JSON.`,
    );
  }
}

function tryReadConfigForDryRun(configPath: string): Record<string, any> | null {
  try {
    return readConfigForBootstrap(configPath);
  } catch (error) {
    if (error instanceof BootstrapError) {
      return null;
    }

    throw error;
  }
}

function writeAutopilotCommandFile(configPath: string): void {
  const configDir = dirname(configPath);
  const commandsDir = join(configDir, 'commands');
  const commandPath = join(commandsDir, 'autopilot.md');

  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(commandPath, AUTOPILOT_COMMAND_FILE);
}

export async function bootstrapAutopilot(
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const steps = [...BOOTSTRAP_STEPS];

  if (options.dryRun) {
    const existingConfig = tryReadConfigForDryRun(options.configPath);
    const merged = existingConfig === null
      ? null
      : mergeOpenCodeConfig(existingConfig, getLocalAutopilotPluginEntry());

    return {
      steps,
      nextCommand: buildNextCommand(options.configPath, true),
      conflicts: merged?.conflicts ?? [],
      readiness:
        merged === null ? getUnreadableReadiness() : getReadinessFromConfig(merged.config),
    };
  }

  const existingConfig = readConfigForBootstrap(options.configPath);
  const backupPath = backupConfigFile(options.configPath);
  const merged = mergeOpenCodeConfig(existingConfig, getLocalAutopilotPluginEntry());

  try {
    writeFileSync(options.configPath, JSON.stringify(merged.config, null, 2));
    writeAutopilotCommandFile(options.configPath);
  } catch {
    throw new BootstrapError(
      'CONFIG_WRITE_FAILED',
      `Unable to write updated OpenCode config to "${options.configPath}".`,
    );
  }

  let writtenConfig: Record<string, any>;
  try {
    writtenConfig = readConfigForBootstrap(options.configPath);
  } catch {
    throw new BootstrapError(
      'CONFIG_VERIFY_FAILED',
      `OpenCode config write completed, but verification failed for "${options.configPath}".`,
    );
  }

  return {
    steps,
    nextCommand: buildNextCommand(options.configPath, false),
    backupPath,
    conflicts: merged.conflicts,
    readiness: getReadinessFromConfig(writtenConfig),
  };
}
