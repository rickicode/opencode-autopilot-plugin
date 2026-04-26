import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOPILOT_AGENT_MANIFEST,
  AUTOPILOT_AGENT_IDS,
  getAgentFallback,
} from './agent-manifest';
import {
  detectAutopilotExecutionTrigger,
  evaluateReadiness,
} from './readiness';
import type {
  ExecutionTriggerInput,
  ReadinessEvaluationInput,
  ReadinessResult,
} from './types';

test('manifest exposes stable keyed contract and fallback behavior', () => {
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.id, 'superpowers');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.role, 'superpowers');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.roleFamily, 'orchestration');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.agentKind, 'primary');
  assert.deepEqual(AUTOPILOT_AGENT_MANIFEST.superpowers.allowedToolSurface, []);
  assert.equal(AUTOPILOT_AGENT_MANIFEST.superpowers.fallbackTarget, null);

  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.id, 'superpowers-explorer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.role, 'explorer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.agentKind, 'delegated-specialist');
  assert.deepEqual(AUTOPILOT_AGENT_MANIFEST.explorer.allowedToolSurface, ['Read', 'Grep', 'Glob']);
  assert.equal(getAgentFallback('superpowers-explorer'), 'builtin-explorer');
  assert.equal(getAgentFallback('superpowers'), null);
  assert.equal(getAgentFallback('unknown-agent'), null);

  assert.equal(AUTOPILOT_AGENT_IDS.length, 6);
  assert(AUTOPILOT_AGENT_IDS.includes('superpowers-reviewer'));
});

test('evaluateReadiness returns ready state for complete canonical and fallback availability', () => {
  const input: ReadinessEvaluationInput = {
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    autopilotCommandFileInstalled: true,
    availableAgents: [
      'autopilot-orchestrator',
      'superpowers',
      'builtin-explorer',
      'builtin-implementer',
      'builtin-knowledge',
      'builtin-designer',
      'builtin-reviewer',
    ],
  };

  const result: ReadinessResult = evaluateReadiness(input);

  assert.deepEqual(result, {
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    installReady: true,
    executionReady: false,
    availableAgents: [
      'superpowers',
      'superpowers-explorer',
      'superpowers-implementer',
      'superpowers-knowledge',
      'superpowers-designer',
      'superpowers-reviewer',
    ],
    ready: true,
    missing: [],
  });
});

test('evaluateReadiness reports missing agent availability', () => {
  assert.deepEqual(
    evaluateReadiness({
      configReadable: true,
      superpowersDeclared: true,
      autopilotInstalled: false,
      autopilotCommandFileInstalled: true,
      availableAgents: [
        'superpowers',
        'builtin-explorer',
        'builtin-implementer',
        'builtin-knowledge',
        'builtin-designer',
      ],
    }),
    {
      configReadable: true,
      superpowersDeclared: true,
      autopilotInstalled: false,
      installReady: false,
      executionReady: false,
      availableAgents: [
        'superpowers',
        'superpowers-explorer',
        'superpowers-implementer',
        'superpowers-knowledge',
        'superpowers-designer',
      ],
      ready: false,
      missing: ['autopilotMissing'],
    },
  );
});

test('evaluateReadiness rejects incomplete agent set even when autopilotInstalled input is true', () => {
  const result = evaluateReadiness({
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    autopilotCommandFileInstalled: true,
    availableAgents: [
      'superpowers',
      'builtin-explorer',
      'builtin-implementer',
      'builtin-knowledge',
      'builtin-designer',
    ],
  });

  assert.equal(result.autopilotInstalled, false);
  assert.equal(result.installReady, false);
  assert.equal(result.executionReady, false);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['autopilotMissing']);
});

test('evaluateReadiness marks execution ready when approved spec and plan artifacts exist', () => {
  const result = evaluateReadiness({
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    autopilotCommandFileInstalled: true,
    availableAgents: [
      'superpowers',
      'builtin-explorer',
      'builtin-implementer',
      'builtin-knowledge',
      'builtin-designer',
      'builtin-reviewer',
    ],
    artifactPaths: [
      'docs/superpowers/specs/task-1-approved.md',
      'docs/superpowers/plans/task-1-approved.md',
    ],
  });

  assert.equal(result.installReady, true);
  assert.equal(result.executionReady, true);
  assert.equal(result.ready, true);
});

test('detectAutopilotExecutionTrigger requires approved spec and approved plan artifacts for artifact execution', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: ['docs/superpowers/specs/task-1-approved.md'],
      currentAction: 'implement task',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'no-trigger',
    },
  );

  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: ['docs/superpowers/plans/task-1-approved.md'],
      currentAction: 'implement task',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'no-trigger',
    },
  );
});

test('detectAutopilotExecutionTrigger does not auto-start on FULL classification alone', () => {
  const input: ExecutionTriggerInput = {
    classification: 'FULL',
    artifactPaths: [],
    currentAction: 'implement task',
    approvalPending: false,
  };

  assert.deepEqual(detectAutopilotExecutionTrigger(input), {
    shouldAutoStart: false,
    reason: 'no-trigger',
  });
});

test('detectAutopilotExecutionTrigger suppresses approved artifact execution when approval is pending', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'FULL',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'implement task',
      approvalPending: true,
    }),
    {
      shouldAutoStart: false,
      reason: 'approval-pending',
    },
  );
});

test('detectAutopilotExecutionTrigger auto-starts on approved plans/specs artifacts outside design review', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/plans/task-1.md',
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'implement task',
      approvalPending: false,
    }),
    {
      shouldAutoStart: true,
      reason: 'artifact-execution',
    },
  );
});

test('detectAutopilotExecutionTrigger suppresses edit design doc actions even with approved artifacts', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'edit design doc for review',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'design-doc-action',
    },
  );
});

test('detectAutopilotExecutionTrigger suppresses review spec actions in either word order', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'review spec',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'design-doc-action',
    },
  );

  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'spec reviewing',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'design-doc-action',
    },
  );

  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'editing spec',
      approvalPending: false,
    }),
    {
      shouldAutoStart: false,
      reason: 'design-doc-action',
    },
  );
});

test('detectAutopilotExecutionTrigger does not suppress unrelated review text', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers/specs/task-1-approved.md',
        'docs/superpowers/plans/task-1-approved.md',
      ],
      currentAction: 'review implementation diff',
      approvalPending: false,
    }),
    {
      shouldAutoStart: true,
      reason: 'artifact-execution',
    },
  );
});
