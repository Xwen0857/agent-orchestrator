import {
  buildEntryActionGuidance,
  extractIntentSignals,
  resolveEntryAction,
  type EntryActionResolution,
} from "./orchestrate-entry-action-contract.js";
import {
  handleReceptionistAmendment,
  handleReceptionistMessage,
} from "./orchestrate-receptionist-command.js";
import type { ReceptionistAmendmentQueue } from "./orchestrate-receptionist.js";
import { appendSessionHistory, type OrchestrateSessionState } from "./orchestrate-session.js";

export type EntryActionQueueMutation = "none" | "write_queue" | "flush_queue";

export type EntryActionStepResult = {
  nextSession: OrchestrateSessionState;
  nextQueue: ReceptionistAmendmentQueue | null;
  queueMutation: EntryActionQueueMutation;
  shouldFlush: boolean;
  plannerApplyRequest: { taskId: string } | null;
  actionResolution: EntryActionResolution | null;
};

function applyClarifyTargetUpdate(params: {
  session: OrchestrateSessionState;
  message: string;
  question: string;
  now: string;
}): OrchestrateSessionState {
  const withHistory = appendSessionHistory(params.session, {
    timestamp: params.now,
    role: "user",
    kind: "message",
    content: params.message.trim(),
  });
  return {
    ...withHistory,
    updated_at: params.now,
    receptionist: {
      ...withHistory.receptionist,
      pending_questions: [params.question],
      amendment_queue_open: false,
      action_route: "clarify_target",
      action_target_task_id: withHistory.last_run?.task_id ?? null,
      clarification_required: true,
      last_action_at: params.now,
    },
  };
}

export function orchestrateEntryActionStep(params: {
  session: OrchestrateSessionState;
  latestUserMessage: string;
  existingQueue: ReceptionistAmendmentQueue | null;
  now?: string;
}): EntryActionStepResult {
  const message = params.latestUserMessage.trim();
  if (!message || message.startsWith("/")) {
    return {
      nextSession: params.session,
      nextQueue: params.existingQueue,
      queueMutation: "none",
      shouldFlush: false,
      plannerApplyRequest: null,
      actionResolution: null,
    };
  }
  const now = params.now ?? new Date().toISOString();
  const actionSignals = extractIntentSignals(message, params.session);
  const actionResolution = resolveEntryAction(actionSignals, params.session);
  if (params.session.status === "RUNNING") {
    if (actionResolution.route === "amend_existing_task") {
      const actionGuidance = buildEntryActionGuidance(actionResolution, params.session);
      const amendment = handleReceptionistAmendment({
        session: {
          ...params.session,
          receptionist: {
            ...params.session.receptionist,
            pending_questions: actionGuidance.missing_configuration.map((field) => `Please provide ${field}.`),
            action_route: "amend_existing_task",
            action_target_task_id: actionResolution.target_task_id,
            clarification_required: false,
            last_action_at: now,
          },
        },
        existingQueue: params.existingQueue,
        message,
        now,
      });
      return {
        nextSession: amendment.session,
        nextQueue: amendment.queue,
        queueMutation: amendment.shouldFlush ? "flush_queue" : amendment.queue ? "write_queue" : "none",
        shouldFlush: amendment.shouldFlush,
        plannerApplyRequest: amendment.shouldFlush && amendment.queue ? { taskId: amendment.queue.task_id } : null,
        actionResolution,
      };
    }
    if (actionResolution.route === "intake_new_task") {
      const intakeNext = handleReceptionistMessage({
        session: params.session,
        message,
        now,
      });
      const intakeGuidance = buildEntryActionGuidance(actionResolution, intakeNext);
      return {
        nextSession: {
          ...intakeNext,
          status: "ACTIVE_DRAFTING",
          receptionist: {
            ...intakeNext.receptionist,
            pending_questions:
              intakeGuidance.missing_configuration.length > 0
                ? intakeGuidance.missing_configuration.map((field) => `Please provide ${field}.`)
                : intakeNext.receptionist.pending_questions,
            amendment_queue_open: false,
            action_route: "intake_new_task",
            action_target_task_id: null,
            clarification_required: false,
            last_action_at: now,
          },
        },
        nextQueue: null,
        queueMutation: "none",
        shouldFlush: false,
        plannerApplyRequest: null,
        actionResolution,
      };
    }
    return {
      nextSession: applyClarifyTargetUpdate({
        session: params.session,
        message,
        question:
          actionResolution.clarification_question ??
          "Are you updating the current task or starting a new task? Reply with: current task / new task.",
        now,
      }),
      nextQueue: params.existingQueue,
      queueMutation: "none",
      shouldFlush: false,
      plannerApplyRequest: null,
      actionResolution,
    };
  }
  if (params.session.status === "ACTIVE_DRAFTING" || params.session.status === "SUMMARY_READY") {
    const intakeNext = handleReceptionistMessage({
      session: params.session,
      message,
      now,
    });
    const intakeGuidance = buildEntryActionGuidance(actionResolution, intakeNext);
    return {
      nextSession: {
        ...intakeNext,
        receptionist: {
          ...intakeNext.receptionist,
          pending_questions:
            intakeGuidance.missing_configuration.length > 0
              ? intakeGuidance.missing_configuration.map((field) => `Please provide ${field}.`)
              : intakeNext.receptionist.pending_questions,
          action_route: "intake_new_task",
          action_target_task_id: null,
          clarification_required: false,
          last_action_at: now,
        },
      },
      nextQueue: params.existingQueue,
      queueMutation: "none",
      shouldFlush: false,
      plannerApplyRequest: null,
      actionResolution,
    };
  }
  return {
    nextSession: params.session,
    nextQueue: params.existingQueue,
    queueMutation: "none",
    shouldFlush: false,
    plannerApplyRequest: null,
    actionResolution,
  };
}
