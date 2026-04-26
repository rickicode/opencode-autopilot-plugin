import {
  buildSubagentConfigs,
  buildOrchestratorConfig,
  getOrchestratorDelegationGuide,
  SUBAGENT_NAMES,
} from './subagents';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

// SUBAGENT_NAMES
assertEqual(
  [...SUBAGENT_NAMES],
  ['explorer', 'librarian', 'oracle', 'designer', 'fixer', 'observer'],
  'SUBAGENT_NAMES contains all 6 subagent names',
);

// buildSubagentConfigs
const configs = buildSubagentConfigs();
for (const name of SUBAGENT_NAMES) {
  assert(configs[name], `subagent config exists for ${name}`);
  assertEqual(configs[name].mode, 'subagent', `${name} has subagent mode`);
  assert(typeof configs[name].prompt === 'string', `${name} has a prompt`);
  assert(typeof configs[name].temperature === 'number', `${name} has temperature`);
  assert(typeof configs[name].description === 'string', `${name} has description`);
}

// Specific temperature checks
assertEqual(configs.explorer.temperature, 0.1, 'explorer has low temperature');
assertEqual(configs.designer.temperature, 0.7, 'designer has higher temperature for creativity');
assertEqual(configs.fixer.temperature, 0.2, 'fixer has moderate-low temperature');

// buildOrchestratorConfig
const orchestrator = buildOrchestratorConfig();
assertEqual(orchestrator.mode, 'primary', 'orchestrator is primary mode');
assertEqual(orchestrator.temperature, 0.1, 'orchestrator has low temperature');
assert(typeof orchestrator.description === 'string', 'orchestrator has description');

// getOrchestratorDelegationGuide
const guide = getOrchestratorDelegationGuide();
assert(guide.includes('@explorer'), 'delegation guide mentions @explorer');
assert(guide.includes('@librarian'), 'delegation guide mentions @librarian');
assert(guide.includes('@oracle'), 'delegation guide mentions @oracle');
assert(guide.includes('@designer'), 'delegation guide mentions @designer');
assert(guide.includes('@fixer'), 'delegation guide mentions @fixer');
assert(guide.includes('@observer'), 'delegation guide mentions @observer');
assert(guide.includes('Delegation Rules'), 'delegation guide includes rules');
assert(guide.includes('leaf node'), 'delegation guide mentions leaf nodes');
