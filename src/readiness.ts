import {
  AUTOPILOT_AGENT_IDS,
  AUTOPILOT_AGENT_MANIFEST,
} from './agent-manifest';
import type {
  AutopilotAgentRole,
  ExecutionTriggerInput,
  ExecutionTriggerResult,
  ReadinessEvaluationInput,
  ReadinessResult,
} from './types';

const APPROVED_ARTIFACT_PATTERN = /-approved\.md$/;

const DESIGN_DOC_TERM_PATTERN = /\b(design\s*doc|spec)\b/i;
const DESIGN_DOC_ACTION_VERB_PATTERN = /\b(edit|editing|review|reviewing)\b/i;

function hasApprovedExecutionArtifacts(artifactPaths: string[]): boolean {
  const hasSpec = artifactPaths.some(
    (artifactPath) =>
      /(^|\/)(docs\/superpowers\/specs)(\/|$)/.test(artifactPath)
      && APPROVED_ARTIFACT_PATTERN.test(artifactPath),
  );
  const hasPlan = artifactPaths.some(
    (artifactPath) =>
      /(^|\/)(docs\/superpowers\/plans)(\/|$)/.test(artifactPath)
      && APPROVED_ARTIFACT_PATTERN.test(artifactPath),
  );

  return hasSpec && hasPlan;
}

function resolveCanonicalAgentAvailability(availableAgents: string[]): string[] {
  const detectedAgents = new Set(availableAgents);
  const resolved: string[] = [];

  for (const role of Object.keys(AUTOPILOT_AGENT_MANIFEST) as AutopilotAgentRole[]) {
    const entry = AUTOPILOT_AGENT_MANIFEST[role];

    if (
      detectedAgents.has(entry.id) ||
      (entry.fallbackTarget !== null && detectedAgents.has(entry.fallbackTarget))
    ) {
      resolved.push(entry.id);
    }
  }

  return resolved;
}

function isDesignDocAction(currentAction: string): boolean {
  return (
    DESIGN_DOC_TERM_PATTERN.test(currentAction) &&
    DESIGN_DOC_ACTION_VERB_PATTERN.test(currentAction)
  );
}

export function evaluateReadiness(
  input: ReadinessEvaluationInput,
): ReadinessResult {
  const availableAgents = resolveCanonicalAgentAvailability(input.availableAgents);
  const autopilotInstalled =
    input.autopilotInstalled && availableAgents.length === AUTOPILOT_AGENT_IDS.length;
  const installReady =
    input.configReadable && input.superpowersDeclared && autopilotInstalled;
  const executionReady =
    installReady && hasApprovedExecutionArtifacts(input.artifactPaths ?? []);
  const missing: ReadinessResult['missing'] = [];

  if (!input.configReadable) {
    missing.push('configUnreadable');
  }

  if (!input.superpowersDeclared) {
    missing.push('superpowersUndeclared');
  }

  if (!autopilotInstalled) {
    missing.push('autopilotMissing');
  }

  return {
    configReadable: input.configReadable,
    superpowersDeclared: input.superpowersDeclared,
    autopilotInstalled,
    installReady,
    executionReady,
    availableAgents,
    ready: installReady,
    missing,
  };
}

export function detectAutopilotExecutionTrigger(
  input: ExecutionTriggerInput,
): ExecutionTriggerResult {
  if (!hasApprovedExecutionArtifacts(input.artifactPaths)) {
    return { shouldAutoStart: false, reason: 'no-trigger' };
  }

  if (input.approvalPending) {
    return { shouldAutoStart: false, reason: 'approval-pending' };
  }

  if (isDesignDocAction(input.currentAction)) {
    return { shouldAutoStart: false, reason: 'design-doc-action' };
  }

  return { shouldAutoStart: true, reason: 'artifact-execution' };
}
