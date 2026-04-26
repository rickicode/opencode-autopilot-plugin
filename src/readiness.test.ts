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
  assert.equal(AUTOPILOT_AGENT_MANIFEST.orchestrator.id, 'autopilot-orchestrator');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.orchestrator.role, 'orchestrator');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.orchestrator.roleFamily, 'orchestration');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.orchestrator.agentKind, 'primary');
  assert.deepEqual(AUTOPILOT_AGENT_MANIFEST.orchestrator.allowedToolSurface, []);
  assert.equal(AUTOPILOT_AGENT_MANIFEST.orchestrator.fallbackTarget, null);

  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.id, 'autopilot-explorer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.role, 'explorer');
  assert.equal(AUTOPILOT_AGENT_MANIFEST.explorer.agentKind, 'delegated-specialist');
  assert.deepEqual(AUTOPILOT_AGENT_MANIFEST.explorer.allowedToolSurface, ['Read', 'Grep', 'Glob']);
  assert.equal(getAgentFallback('autopilot-explorer'), 'builtin-explorer');
  assert.equal(getAgentFallback('autopilot-orchestrator'), null);
  assert.equal(getAgentFallback('unknown-agent'), null);

  assert.equal(AUTOPILOT_AGENT_IDS.length, 6);
  assert(AUTOPILOT_AGENT_IDS.includes('autopilot-reviewer'));
});

test('evaluateReadiness returns ready state for complete canonical and fallback availability', () => {
  const input: ReadinessEvaluationInput = {
    configReadable: true,
    superpowersDeclared: true,
    autopilotInstalled: true,
    availableAgents: [
      'autopilot-orchestrator',
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
    availableAgents: [
      'autopilot-orchestrator',
      'autopilot-explorer',
      'autopilot-implementer',
      'autopilot-knowledge',
      'autopilot-designer',
      'autopilot-reviewer',
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
      availableAgents: [
        'autopilot-orchestrator',
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
      availableAgents: [
        'autopilot-orchestrator',
        'autopilot-explorer',
        'autopilot-implementer',
        'autopilot-knowledge',
        'autopilot-designer',
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
    availableAgents: [
      'autopilot-orchestrator',
      'builtin-explorer',
      'builtin-implementer',
      'builtin-knowledge',
      'builtin-designer',
    ],
  });

  assert.equal(result.autopilotInstalled, false);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['autopilotMissing']);
});

test('detectAutopilotExecutionTrigger auto-starts FULL classification when approval is not pending', () => {
  const input: ExecutionTriggerInput = {
    classification: 'FULL',
    artifactPaths: [],
    currentAction: 'implement task',
    approvalPending: false,
  };

  assert.deepEqual(detectAutopilotExecutionTrigger(input), {
    shouldAutoStart: true,
    reason: 'full-execution',
  });
});

test('detectAutopilotExecutionTrigger suppresses FULL classification when approval is pending', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'FULL',
      artifactPaths: ['docs/superpowers-optimized/plans/task-1.md'],
      currentAction: 'implement task',
      approvalPending: true,
    }),
    {
      shouldAutoStart: false,
      reason: 'approval-pending',
    },
  );
});

test('detectAutopilotExecutionTrigger auto-starts on plans/specs artifacts outside design review', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: [
        'docs/superpowers-optimized/plans/task-1.md',
        'docs/superpowers-optimized/specs/task-1.md',
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

test('detectAutopilotExecutionTrigger suppresses edit design doc actions', () => {
  assert.deepEqual(
    detectAutopilotExecutionTrigger({
      classification: 'LIGHTWEIGHT',
      artifactPaths: ['docs/superpowers-optimized/specs/task-1.md'],
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
      artifactPaths: ['docs/superpowers-optimized/specs/task-1.md'],
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
      artifactPaths: ['docs/superpowers-optimized/specs/task-1.md'],
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
      artifactPaths: ['docs/superpowers-optimized/specs/task-1.md'],
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
      artifactPaths: ['docs/superpowers-optimized/plans/task-1.md'],
      currentAction: 'review implementation diff',
      approvalPending: false,
    }),
    {
      shouldAutoStart: true,
      reason: 'artifact-execution',
    },
  );
});
