import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  bootstrapAutopilot,
  getReadinessFromConfig,
  readCurrentReadiness,
} from './bootstrap';
import {
  backupConfigFile,
  MANAGED_AUTOPILOT_AGENT_IDS,
  mergeOpenCodeConfig,
  SUPERPOWERS_PLUGIN,
} from './config-merge';

function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

test('backup preserves original config contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-config-'));
  const configPath = join(root, 'opencode.json');
  const original = JSON.stringify({ plugin: ['custom-plugin'] }, null, 2);

  writeFileSync(configPath, original);

  const backupPath = backupConfigFile(configPath);

  assert.equal(readFileSync(backupPath, 'utf8'), original);
});

test('backup generates a unique path when default backup already exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-config-'));
  const configPath = join(root, 'opencode.json');
  const original = JSON.stringify({ plugin: ['custom-plugin'] }, null, 2);
  const existingBackupPath = `${configPath}.bak`;

  writeFileSync(configPath, original);
  writeFileSync(existingBackupPath, 'existing-backup');

  const backupPath = backupConfigFile(configPath);

  assert.notEqual(backupPath, existingBackupPath);
  assert.equal(readFileSync(existingBackupPath, 'utf8'), 'existing-backup');
  assert.equal(readFileSync(backupPath, 'utf8'), original);
});

test('merge keeps unrelated plugin entries and adds superpowers plugin if missing', () => {
  const merged = mergeOpenCodeConfig({
    plugin: ['custom-plugin'],
  });

  assert.deepEqual(merged.config.plugin, ['custom-plugin', SUPERPOWERS_PLUGIN]);
  assert.deepEqual(merged.conflicts, []);
});

test('merge preserves non-array plugin values and reports a conflict', () => {
  const merged = mergeOpenCodeConfig({
    plugin: 'user-plugin',
  });

  assert.equal(merged.config.plugin, 'user-plugin');
  assert.deepEqual(merged.conflicts, ['plugin']);
});

test('merge preserves unrelated agents', () => {
  const merged = mergeOpenCodeConfig({
    agent: {
      existing: { prompt: 'keep-me' },
    },
  });

  assert.equal(merged.config.agent.existing.prompt, 'keep-me');
});

test('merge preserves non-object agent values and reports a conflict', () => {
  const merged = mergeOpenCodeConfig({
    agent: 'user-agent',
  });

  assert.equal(merged.config.agent, 'user-agent');
  assert.deepEqual(merged.conflicts, ['agent']);
});

test('merge reports incompatible orchestrator conflict when existing user-owned agent collides', () => {
  const merged = mergeOpenCodeConfig({
    agent: {
      'autopilot-orchestrator': { prompt: 'user-custom' },
    },
  });

  assert.equal(merged.config.agent['autopilot-orchestrator'].prompt, 'user-custom');
  assert.deepEqual(merged.conflicts, ['agent.autopilot-orchestrator']);
});

test('merge preserves conflicting default_agent with warning', () => {
  const merged = mergeOpenCodeConfig({
    default_agent: 'existing',
    agent: {
      existing: { prompt: 'keep-me' },
    },
  });

  assert.equal(merged.config.default_agent, 'existing');
  assert.deepEqual(merged.conflicts, ['default_agent']);
});

test('merge safely provisions managed autopilot-owned agents without conflicts', () => {
  const merged = mergeOpenCodeConfig({
    agent: {
      'autopilot-explorer': {
        model: 'legacy',
        description: 'old value should be managed',
        metadata: { owner: 'autopilot' },
      },
    },
  });

  assert.deepEqual(merged.conflicts, []);
  for (const id of MANAGED_AUTOPILOT_AGENT_IDS) {
    assert.ok(merged.config.agent[id], `expected managed agent ${id}`);
    assert.equal(merged.config.agent[id].metadata.owner, 'autopilot');
  }
  assert.equal(merged.config.agent['autopilot-explorer'].description, 'Autopilot managed explorer agent');
});

test('merge preserves nested metadata for autopilot-owned managed agents', () => {
  const merged = mergeOpenCodeConfig({
    agent: {
      'autopilot-explorer': {
        prompt: 'keep-me',
        metadata: {
          owner: 'autopilot',
          labels: ['existing'],
          nested: {
            keep: true,
          },
        },
      },
    },
  });

  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.config.agent['autopilot-explorer'].prompt, 'keep-me');
  assert.deepEqual(merged.config.agent['autopilot-explorer'].metadata, {
    owner: 'autopilot',
    labels: ['existing'],
    nested: {
      keep: true,
    },
  });
});

test('bootstrap dry-run returns ordered wizard steps and supported npm apply guidance', async () => {
  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath: '/tmp/opencode.json',
  });

  assert.equal(result.steps[0], 'detect-opencode');
  assert.deepEqual(result.steps, [
    'detect-opencode',
    'backup-config',
    'ensure-superpowers',
    'install-autopilot',
    'provision-agents',
    'validate-readiness',
  ]);
  assert.ok(result.steps.includes('ensure-superpowers'));
  assert.ok(result.steps.includes('install-autopilot'));
  assert.ok(result.steps.includes('provision-agents'));
  assert.match(result.nextCommand, /Apply for real:/);
  assert.match(result.nextCommand, /npm run bootstrap:install/);
  assert.doesNotMatch(result.nextCommand, /node scripts\/install-autopilot\.mjs/);
  assert.doesNotMatch(result.nextCommand, /curl/i);
  assert.doesNotMatch(result.nextCommand, /AUTOPILOT_DRY_RUN=1/);
});

test('bootstrap dry-run leaves filesystem untouched and computes readiness from simulated config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-dry-run-'));
  const configPath = join(root, 'opencode.json');
  const original = JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      existing: { prompt: 'keep-me' },
    },
  }, null, 2);

  writeFileSync(configPath, original);

  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath,
  });

  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.equal(existsSync(`${configPath}.bak`), false);
  assert.equal(result.backupPath, undefined);
  assert.equal(result.readiness.configReadable, true);
  assert.equal(result.readiness.ready, true);
  assert.deepEqual(result.conflicts, []);
});

test('bootstrap dry-run reports readiness from merged valid config instead of fake-ready defaults', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-dry-run-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      existing: { prompt: 'keep-me' },
    },
  }, null, 2));

  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath,
  });

  assert.equal(result.readiness.configReadable, true);
  assert.equal(result.readiness.superpowersDeclared, true);
  assert.equal(result.readiness.autopilotInstalled, true);
  assert.equal(result.readiness.ready, true);
});

test('bootstrap non-dry-run returns supported npm dry-run guidance instead of direct script invocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-bootstrap-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
  }, null, 2));

  const result = await bootstrapAutopilot({
    configPath,
  });

  assert.match(result.nextCommand, /Verify installation:/);
  assert.match(result.nextCommand, /npm run readiness:check/);
  assert.doesNotMatch(result.nextCommand, /AUTOPILOT_DRY_RUN=1/);
  assert.doesNotMatch(result.nextCommand, /node scripts\/install-autopilot\.mjs/);
  assert.doesNotMatch(result.nextCommand, /curl/i);
});

test('bootstrap nextCommand safely quotes config paths with spaces and shell-sensitive characters', async () => {
  const configPath = "/tmp/autopilot path/it's $HOME;rm -rf ~/.json";

  const dryRunResult = await bootstrapAutopilot({
    dryRun: true,
    configPath,
  });

  const applyCommand = "Apply for real: OPENCODE_CONFIG_PATH='/tmp/autopilot path/it'\\''s $HOME;rm -rf ~/.json' npm run bootstrap:install";
  assert.equal(dryRunResult.nextCommand, applyCommand);

  const root = mkdtempSync(join(tmpdir(), 'autopilot-bootstrap-'));
  const realConfigPath = join(root, 'opencode.json');
  writeFileSync(realConfigPath, JSON.stringify({ plugin: ['custom-plugin'] }, null, 2));

  const verifyResult = await bootstrapAutopilot({
    configPath: realConfigPath.replace('opencode.json', "space '$HOME';config.json"),
  }).catch(() => null);

  assert.equal(verifyResult, null);

  const quotedVerifyPath = join(root, "space '$HOME';config.json");
  writeFileSync(quotedVerifyPath, JSON.stringify({ plugin: ['custom-plugin'] }, null, 2));

  const result = await bootstrapAutopilot({
    configPath: quotedVerifyPath,
  });

  assert.equal(
    result.nextCommand,
    `Verify installation: OPENCODE_CONFIG_PATH='${quotedVerifyPath.replace(/'/g, `'\\''`)}' npm run readiness:check`,
  );
});

test('README documents the integrated bootstrap flow and managed dependencies', () => {
  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

  assert.match(readme, /npm run bootstrap:install/);
  assert.match(readme, /npm run bootstrap:dry-run/);
  assert.match(readme, /not\*\* the current supported path/i);
  assert.match(readme, /curl -fsSL/);
  assert.match(readme, /obra\/superpowers/);
  assert.match(readme, /autopilot-orchestrator/);
  assert.match(readme, /npm run readiness:check/);
});

test('README documents actual auto-start triggers for FULL and artifact execution flows', () => {
  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

  assert.match(readme, /automatically activates autopilot for FULL tasks/i);
  assert.match(readme, /artifact-based execution can also auto-start/i);
  assert.match(readme, /spec\/plan artifacts/i);
  assert.match(readme, /does not auto-start when the current action is design-doc\/spec editing or review/i);
});

test('package scripts expose full compiled test suite and readiness exit semantics', () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.match(packageJson.scripts?.test ?? '', /^npm run build && node --test /);
  assert.match(packageJson.scripts?.test ?? '', /dist\/\*\.test\.js/);
  assert.match(packageJson.scripts?.['readiness:check'] ?? '', /readCurrentReadiness/);
  assert.doesNotMatch(packageJson.scripts?.['readiness:check'] ?? '', /bootstrapAutopilot/);
  assert.match(packageJson.scripts?.['readiness:check'] ?? '', /ready=/);
  assert.match(packageJson.scripts?.['readiness:check'] ?? '', /missing=/);
  assert.match(packageJson.scripts?.['readiness:check'] ?? '', /process\.exit\(result\.readiness\.ready \? 0 : 1\)/);
});

test('readCurrentReadiness reads config as installed on disk without simulating merge', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-readiness-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      existing: { prompt: 'keep-me' },
    },
  }, null, 2));

  const result = readCurrentReadiness(configPath);

  assert.equal(result.readiness.configReadable, true);
  assert.equal(result.readiness.ready, false);
  assert.deepEqual(result.readiness.missing, ['superpowersUndeclared', 'autopilotMissing']);
});

test('readiness check script exits non-zero after printing readiness details when not ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-readiness-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      existing: { prompt: 'keep-me' },
    },
  }, null, 2));

  const result = spawnSync(getNpmCommand(), ['run', 'readiness:check', '--silent'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      OPENCODE_CONFIG_PATH: configPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /detect-opencode/);
  assert.match(result.stdout, /ready=false/);
  assert.match(result.stdout, /missing=.*superpowersUndeclared/);
  assert.match(result.stdout, /missing=.*autopilotMissing/);
});

test('readiness check script exits zero for an already-installed current config', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-readiness-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: [SUPERPOWERS_PLUGIN],
    agent: Object.fromEntries(
      MANAGED_AUTOPILOT_AGENT_IDS.map((id) => [id, { prompt: `${id}-prompt` }]),
    ),
  }, null, 2));

  const result = spawnSync(getNpmCommand(), ['run', 'readiness:check', '--silent'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      OPENCODE_CONFIG_PATH: configPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready=true/);
  assert.match(result.stdout, /missing=$/m);
});

test('bootstrap dry-run reports unreadable readiness for nonexistent config path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-dry-run-'));
  const configPath = join(root, 'missing.json');

  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath,
  });

  assert.equal(result.readiness.configReadable, false);
  assert.equal(result.readiness.ready, false);
  assert.deepEqual(result.readiness.missing, ['configUnreadable', 'superpowersUndeclared', 'autopilotMissing']);
});

test('bootstrap dry-run reports unreadable readiness for invalid json config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-dry-run-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, '{ invalid json');

  const result = await bootstrapAutopilot({
    dryRun: true,
    configPath,
  });

  assert.equal(result.readiness.configReadable, false);
  assert.equal(result.readiness.ready, false);
  assert.deepEqual(result.readiness.missing, ['configUnreadable', 'superpowersUndeclared', 'autopilotMissing']);
});

test('bootstrap readiness detection requires exact superpowers plugin membership', () => {
  const result = getReadinessFromConfig({
    plugin: [`prefix:${SUPERPOWERS_PLUGIN}:suffix`],
    agent: {
      'autopilot-orchestrator': { prompt: 'managed' },
      'autopilot-explorer': { prompt: 'managed' },
      'autopilot-implementer': { prompt: 'managed' },
      'autopilot-knowledge': { prompt: 'managed' },
      'autopilot-designer': { prompt: 'managed' },
      'autopilot-reviewer': { prompt: 'managed' },
    },
  });

  assert.equal(result.superpowersDeclared, false);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['superpowersUndeclared']);
});

test('bootstrap writes merged config and backup when not dry-run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-bootstrap-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, JSON.stringify({
    plugin: ['custom-plugin'],
    agent: {
      existing: { prompt: 'keep-me' },
    },
  }, null, 2));

  const result = await bootstrapAutopilot({
    configPath,
  });

  const writtenConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
    plugin: string[];
    agent: Record<string, { prompt?: string; metadata?: { owner?: string } }>;
    default_agent?: string;
  };

  assert.ok(result.backupPath);
  assert.equal(readFileSync(result.backupPath!, 'utf8').includes('custom-plugin'), true);
  assert.ok(writtenConfig.plugin.includes(SUPERPOWERS_PLUGIN));
  assert.equal(writtenConfig.agent.existing.prompt, 'keep-me');
  assert.equal(writtenConfig.default_agent, 'autopilot-orchestrator');
  for (const id of MANAGED_AUTOPILOT_AGENT_IDS) {
    assert.equal(writtenConfig.agent[id].metadata?.owner, 'autopilot');
  }
  assert.equal(result.readiness.ready, true);
});

test('installer script honors dry-run mode without mutating config', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-script-'));
  const configPath = join(root, 'opencode.json');
  const original = JSON.stringify({ plugin: ['custom-plugin'] }, null, 2);

  writeFileSync(configPath, original);

  const result = spawnSync(process.execPath, ['scripts/install-autopilot.mjs'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      AUTOPILOT_DRY_RUN: '1',
      OPENCODE_CONFIG_PATH: configPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.equal(existsSync(`${configPath}.bak`), false);
  assert.match(result.stdout, /\[bootstrap\] ready:/);
});

test('installer script reports missing HOME or config path clearly', () => {
  const result = spawnSync(process.execPath, ['scripts/install-autopilot.mjs'], {
    cwd: join(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to determine OpenCode config path/i);
  assert.doesNotMatch(result.stderr, /Error:|at .*install-autopilot/m);
});

test('installer script reports resolved default HOME-derived config path on failure', () => {
  const home = mkdtempSync(join(tmpdir(), 'autopilot-home-'));
  const expectedPath = join(home, '.config', 'opencode', 'opencode.json');

  const result = spawnSync(process.execPath, ['scripts/install-autopilot.mjs'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      OPENCODE_CONFIG_PATH: '',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result.stderr, /<unknown>/);
});

test('installer script reports invalid json clearly', () => {
  const root = mkdtempSync(join(tmpdir(), 'autopilot-script-'));
  const configPath = join(root, 'opencode.json');

  writeFileSync(configPath, '{ invalid json');

  const result = spawnSync(process.execPath, ['scripts/install-autopilot.mjs'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      OPENCODE_CONFIG_PATH: configPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid json/i);
  assert.doesNotMatch(result.stderr, /SyntaxError:|at .*bootstrap/m);
});
