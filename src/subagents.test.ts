import {
  buildSubagentConfigs,
  buildSuperpowersConfig,
  getSuperpowersDelegationGuide,
  SUBAGENT_NAMES,
  SUBAGENT_RUNTIME_IDS,
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
  ['explorer', 'knowledge', 'designer', 'implementer', 'reviewer'],
  'SUBAGENT_NAMES contains all 6 subagent names',
);

// buildSubagentConfigs
const configs = buildSubagentConfigs();
for (const name of SUBAGENT_NAMES) {
  const runtimeId = SUBAGENT_RUNTIME_IDS[name];
  assert(configs[runtimeId], `subagent config exists for ${runtimeId}`);
  assertEqual(configs[runtimeId].mode, 'subagent', `${runtimeId} has subagent mode`);
  assert(typeof configs[runtimeId].prompt === 'string', `${runtimeId} has a prompt`);
  assert(typeof configs[runtimeId].temperature === 'number', `${runtimeId} has temperature`);
  assert(typeof configs[runtimeId].description === 'string', `${runtimeId} has description`);
}

// Specific temperature checks
assertEqual(configs['superpowers-explorer'].temperature, 0.1, 'explorer has low temperature');
assertEqual(configs['superpowers-designer'].temperature, 0.7, 'designer has higher temperature for creativity');
assertEqual(configs['superpowers-implementer'].temperature, 0.2, 'implementer has moderate-low temperature');

// buildSuperpowersConfig
const superpowers = buildSuperpowersConfig();
assertEqual(superpowers.mode, 'primary', 'superpowers is primary mode');
assertEqual(superpowers.temperature, 0.1, 'superpowers has low temperature');
assert(typeof superpowers.description === 'string', 'superpowers has description');

// getSuperpowersDelegationGuide
const guide = getSuperpowersDelegationGuide();
assert(guide.includes('@explorer'), 'delegation guide mentions @explorer');
assert(guide.includes('@knowledge'), 'delegation guide mentions @knowledge');
assert(guide.includes('@reviewer'), 'delegation guide mentions @reviewer');
assert(guide.includes('@designer'), 'delegation guide mentions @designer');
assert(guide.includes('@implementer'), 'delegation guide mentions @implementer');
assert(guide.includes('Delegation Rules'), 'delegation guide includes rules');
assert(guide.includes('leaf node'), 'delegation guide mentions leaf nodes');
