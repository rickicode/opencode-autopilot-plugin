import type {
  AutopilotAgentKind,
  AutopilotAgentRole,
  AutopilotAgentRoleFamily,
  AutopilotAgentToolSurface,
} from './types';

export interface AutopilotAgentManifestEntry {
  id: string;
  role: AutopilotAgentRole;
  roleFamily: AutopilotAgentRoleFamily;
  agentKind: AutopilotAgentKind;
  minimumPromptResponsibility: string;
  allowedToolSurface: AutopilotAgentToolSurface[];
  fallbackTarget: string | null;
}

export type AutopilotAgentManifest = Record<
  AutopilotAgentRole,
  AutopilotAgentManifestEntry
>;

export const AUTOPILOT_AGENT_MANIFEST: AutopilotAgentManifest = {
  superpowers: {
    id: 'superpowers',
    role: 'superpowers',
    roleFamily: 'orchestration',
    agentKind: 'primary',
    minimumPromptResponsibility:
      'Own end-to-end task orchestration and decide when delegated specialists are needed.',
    allowedToolSurface: [],
    fallbackTarget: null,
  },
  explorer: {
    id: 'superpowers-explorer',
    role: 'explorer',
    roleFamily: 'exploration',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Inspect repository structure and gather relevant code context before execution.',
    allowedToolSurface: ['Read', 'Grep', 'Glob'],
    fallbackTarget: 'builtin-explorer',
  },
  implementer: {
    id: 'superpowers-implementer',
    role: 'implementer',
    roleFamily: 'implementation',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Apply the smallest validated code change that satisfies the current task contract.',
    allowedToolSurface: ['Read', 'Edit', 'Write', 'Bash'],
    fallbackTarget: 'builtin-implementer',
  },
  knowledge: {
    id: 'superpowers-knowledge',
    role: 'knowledge',
    roleFamily: 'knowledge',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Retrieve durable project facts, prior constraints, and supporting references.',
    allowedToolSurface: ['Read', 'Grep', 'WebFetch'],
    fallbackTarget: 'builtin-knowledge',
  },
  designer: {
    id: 'superpowers-designer',
    role: 'designer',
    roleFamily: 'design',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Shape implementation approach, acceptance boundaries, and task decomposition intent.',
    allowedToolSurface: ['Read', 'Write'],
    fallbackTarget: 'builtin-designer',
  },
  reviewer: {
    id: 'superpowers-reviewer',
    role: 'reviewer',
    roleFamily: 'review',
    agentKind: 'delegated-specialist',
    minimumPromptResponsibility:
      'Verify requirement compliance, quality risks, and final readiness before completion.',
    allowedToolSurface: ['Read', 'Grep', 'Bash'],
    fallbackTarget: 'builtin-reviewer',
  },
};

export const AUTOPILOT_AGENT_IDS = [
  AUTOPILOT_AGENT_MANIFEST.superpowers.id,
  AUTOPILOT_AGENT_MANIFEST.explorer.id,
  AUTOPILOT_AGENT_MANIFEST.implementer.id,
  AUTOPILOT_AGENT_MANIFEST.knowledge.id,
  AUTOPILOT_AGENT_MANIFEST.designer.id,
  AUTOPILOT_AGENT_MANIFEST.reviewer.id,
];

export function getAgentFallback(agentID: string): string | null {
  for (const role of Object.keys(AUTOPILOT_AGENT_MANIFEST) as AutopilotAgentRole[]) {
    const entry = AUTOPILOT_AGENT_MANIFEST[role];
    if (entry.id === agentID) {
      return entry.fallbackTarget;
    }
  }

  return null;
}
