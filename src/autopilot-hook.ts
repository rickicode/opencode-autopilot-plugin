import type { PluginInput } from '@opencode-ai/plugin';
import type {
  AutopilotConfig,
  AutopilotState,
  CommandInput,
  CommandOutput,
} from './types';
import { DEFAULT_CONFIG } from './types';
import {
  parseAutopilotCommand,
  createInternalPrompt,
  formatStatus,
} from './utils';

export function createAutopilotHook(
  ctx: PluginInput,
  userConfig?: Partial<AutopilotConfig>,
) {
  const config: AutopilotConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const sessions = new Map<string, AutopilotState>();

  function getOrCreateState(sessionID: string): AutopilotState {
    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, {
        enabled: false,
        sessionID,
        task: '',
        maxLoops: config.defaultMaxLoops,
        currentLoop: 0,
        currentPhase: 'design',
        phaseLoopCount: 0,
        startTime: 0,
        lastActivity: 0,
        pendingTimer: null,
      });
    }

    return sessions.get(sessionID)!;
  }

  function cancelPendingTimer(state: AutopilotState): void {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function resetState(sessionID: string): void {
    const state = sessions.get(sessionID);
    if (state) {
      cancelPendingTimer(state);
      sessions.delete(sessionID);
    }
  }

  async function handleCommandExecuteBefore(
    input: CommandInput,
    output: CommandOutput,
  ): Promise<void> {
    if (input.command !== 'autopilot') {
      return;
    }

    output.parts.length = 0;

    const parsed = parseAutopilotCommand(input.arguments);

    if (parsed.error) {
      output.parts.push(createInternalPrompt(`Error: ${parsed.error}`));
      return;
    }

    const state = getOrCreateState(input.sessionID);

    switch (parsed.action) {
      case 'off':
        cancelPendingTimer(state);
        state.enabled = false;
        output.parts.push(createInternalPrompt('Autopilot disabled.'));
        break;

      case 'status':
        output.parts.push(createInternalPrompt(formatStatus(state)));
        break;

      case 'resume':
        if (!state.task) {
          output.parts.push(
            createInternalPrompt('No previous autopilot session to resume.'),
          );
          return;
        }

        state.enabled = true;
        output.parts.push(
          createInternalPrompt(
            `Autopilot resumed: ${state.task}\nContinuing from loop ${state.currentLoop}/${state.maxLoops}`,
          ),
        );
        break;

      case 'start':
        if (!parsed.task) {
          output.parts.push(createInternalPrompt('Error: task is required'));
          return;
        }

        state.enabled = true;
        state.task = parsed.task;
        state.maxLoops = parsed.maxLoops ?? config.defaultMaxLoops;
        state.currentLoop = 0;
        state.currentPhase = 'design';
        state.phaseLoopCount = 0;
        state.startTime = Date.now();
        state.lastActivity = Date.now();

        output.parts.push(
          createInternalPrompt(
            [
              `Autopilot enabled: ${state.task}`,
              `Max loops: ${state.maxLoops}`,
              '',
              'You are the superpowers agent. Execute this task autonomously using full superpowers workflow:',
              '1. Design (brainstorming) - auto-approve if unambiguous',
              '2. Plan (writing-plans) - auto-proceed to execution',
              '3. Execute (subagent-driven-development) - auto-continue through tasks',
              '4. Verify (verification-before-completion) - auto-proceed if pass',
              '5. Complete (finishing-a-development-branch) - STOP for user decision',
              '',
              'Stop and ask for user input only when:',
              '- Design: ambiguous requirements, multiple valid approaches',
              '- Plan: critical gaps, missing dependencies',
              '- Execute: implementer BLOCKED, verification FAILED',
              '- Complete: always stop before merge/PR',
              '',
              `Task: ${state.task}`,
            ].join('\n'),
          ),
        );
        break;
    }
  }

  async function handleSessionIdle(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID);
    if (!state || !state.enabled) {
      return;
    }

    if (state.currentLoop >= state.maxLoops) {
      state.enabled = false;
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [
            createInternalPrompt(
              `Autopilot stopped: reached max loops (${state.maxLoops}).\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
            ),
          ],
        },
      });
      return;
    }

    if (state.phaseLoopCount >= config.maxLoopsPerPhase) {
      state.enabled = false;
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [
            createInternalPrompt(
              `Autopilot stopped: reached max loops per phase (${config.maxLoopsPerPhase}) in ${state.currentPhase} phase.\n\nUse /autopilot resume to continue, or /autopilot off to disable.`,
            ),
          ],
        },
      });
      return;
    }

    state.pendingTimer = setTimeout(async () => {
      state.pendingTimer = null;
      state.currentLoop++;
      state.phaseLoopCount++;
      state.lastActivity = Date.now();

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [
            createInternalPrompt(
              `[Autopilot loop ${state.currentLoop}/${state.maxLoops}] Continue with next step. Press Esc to stop.`,
            ),
          ],
        },
      });
    }, config.cooldownMs);
  }

  async function handleEvent(input: {
    event: { type: string; properties?: Record<string, unknown> };
  }): Promise<void> {
    const { event } = input;

    if (event.type === 'session.idle') {
      const sessionID = event.properties?.sessionID as string;
      if (sessionID) {
        await handleSessionIdle(sessionID);
      }
    } else if (event.type === 'session.deleted') {
      const sessionID =
        ((event.properties?.info as { id?: string })?.id as string) ??
        (event.properties?.sessionID as string);
      if (sessionID) {
        resetState(sessionID);
      }
    } else if (event.type === 'session.status') {
      const sessionID = event.properties?.sessionID as string;
      const status = event.properties?.status as { type: string };
      if (sessionID && status?.type === 'busy') {
        const state = sessions.get(sessionID);
        if (state) {
          cancelPendingTimer(state);
        }
      }
    }
  }

  return {
    handleCommandExecuteBefore,
    handleEvent,
  };
}
