let bootstrapAutopilot;

async function loadBootstrapAutopilot() {
  try {
    const module = await import('../dist/bootstrap.js');
    return module.bootstrapAutopilot;
  } catch {
    throw new Error(
      'Built bootstrap entrypoint dist/bootstrap.js is unavailable. Run "npm run build" or use the supported npm scripts: "npm run bootstrap:install" or "npm run bootstrap:dry-run".',
    );
  }
}

function resolveConfigPath() {
  if (process.env.OPENCODE_CONFIG_PATH) {
    return process.env.OPENCODE_CONFIG_PATH;
  }

  if (!process.env.HOME) {
    throw new Error(
      'Unable to determine OpenCode config path. Set OPENCODE_CONFIG_PATH or HOME first.',
    );
  }

  return `${process.env.HOME}/.config/opencode/opencode.json`;
}

function formatBootstrapError(error, configPath) {
  if (!(error instanceof Error)) {
    return 'Autopilot bootstrap failed for an unknown reason.';
  }

  switch (error.code) {
    case 'CONFIG_NOT_FOUND':
      return `OpenCode config was not found at "${configPath}".`;
    case 'CONFIG_INVALID_JSON':
      return `OpenCode config at "${configPath}" contains invalid JSON.`;
    case 'CONFIG_READ_FAILED':
      return `Unable to read OpenCode config at "${configPath}".`;
    case 'CONFIG_WRITE_FAILED':
      return `Unable to write updated OpenCode config to "${configPath}".`;
    case 'CONFIG_VERIFY_FAILED':
      return `OpenCode config write completed, but verification failed for "${configPath}".`;
    default:
      return error.message;
  }
}

let configPath = '<unknown>';

try {
  bootstrapAutopilot = await loadBootstrapAutopilot();

  configPath = resolveConfigPath();
  const result = await bootstrapAutopilot({
    configPath,
    dryRun: process.env.AUTOPILOT_DRY_RUN === '1',
  });

  for (const step of result.steps) {
    console.log(`[bootstrap] ${step}`);
  }

  if (result.backupPath) {
    console.log(`[bootstrap] backup: ${result.backupPath}`);
  }

  if (result.conflicts.length > 0) {
    console.log(`[bootstrap] conflicts: ${result.conflicts.join(', ')}`);
  }

  console.log(`[bootstrap] ready: ${result.readiness.ready ? 'yes' : 'no'}`);
  console.log(`[bootstrap] next: ${result.nextCommand}`);
} catch (error) {
  console.error(`[bootstrap] ${formatBootstrapError(error, configPath)}`);
  process.exit(1);
}
