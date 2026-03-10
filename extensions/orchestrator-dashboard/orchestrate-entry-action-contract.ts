export type EntryActionRoute = "amend_existing_task" | "intake_new_task" | "clarify_target";

export type EntryActionIntentSignals = {
  message: string;
  normalized_message: string;
  is_slash_command: boolean;
  session_status: "ACTIVE_DRAFTING" | "SUMMARY_READY" | "RUNNING" | "CLOSED";
  bound_task_id: string | null;
  explicit_task_id: string | null;
  has_new_task_intent: boolean;
  has_existing_task_intent: boolean;
  has_amendment_intent: boolean;
  clarification_required: boolean;
};

export type EntryActionResolution = {
  route: EntryActionRoute;
  target_task_id: string | null;
  clarification_required: boolean;
  guidance_reason: string;
  clarification_question: string | null;
};

export type EntryActionGuidance = {
  missing_configuration: Array<"task_goal" | "project_id" | "workspace_root" | "budget" | "risk_level">;
  next_step: "collect_amendment" | "collect_intake" | "await_clarification";
};

type SessionView = {
  status: "ACTIVE_DRAFTING" | "SUMMARY_READY" | "RUNNING" | "CLOSED";
  last_run?: { task_id: string } | null;
  draft: {
    task_goal: string;
    project_id: string;
    workspace_root: string;
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    budget: {
      max_token_cost: number;
      max_execution_time_seconds: number;
    };
  };
  receptionist: {
    clarification_required: boolean;
    action_route: EntryActionRoute;
    action_target_task_id: string | null;
  };
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function extractExplicitTaskId(message: string): string | null {
  const taskIdMatch = message.match(/task[_\s-]*id\s*[:=]\s*([A-Za-z0-9._-]+)/iu);
  if (taskIdMatch?.[1]) {
    return taskIdMatch[1].trim();
  }
  const tokenMatch = message.match(/\b(task_[A-Za-z0-9._-]+)\b/u);
  return tokenMatch?.[1]?.trim() ?? null;
}

function buildClarificationQuestion(taskId: string | null): string {
  if (taskId) {
    return `Are you updating current task ${taskId} or starting a new task? Reply with: current task / new task.`;
  }
  return "Are you updating the current task or starting a new task? Reply with: current task / new task.";
}

function hasPattern(message: string, pattern: RegExp): boolean {
  return pattern.test(message);
}

function resolveClarificationAnswer(
  normalizedMessage: string,
): "current_task" | "new_task" | null {
  const currentHit = /(当前|继续当前|现有|this one|current|existing|continue)/iu.test(
    normalizedMessage,
  );
  const newHit = /(新任务|另开|重新开|new|another|separate)/iu.test(normalizedMessage);
  if (currentHit && newHit) {
    return null;
  }
  if (currentHit) {
    return "current_task";
  }
  if (newHit) {
    return "new_task";
  }
  return null;
}

export function extractIntentSignals(
  message: string,
  session: SessionView,
): EntryActionIntentSignals {
  const text = message.trim();
  const normalized = text.toLowerCase();
  return {
    message: text,
    normalized_message: normalized,
    is_slash_command: text.startsWith("/"),
    session_status: session.status,
    bound_task_id: normalizeOptionalString(session.last_run?.task_id ?? null),
    explicit_task_id: normalizeOptionalString(extractExplicitTaskId(text)),
    has_new_task_intent: hasPattern(
      text,
      /(新任务|另开|另外一个任务|开新|new task|another task|separate task|start a new task)/iu,
    ),
    has_existing_task_intent: hasPattern(
      text,
      /(继续当前|当前任务|修改这个任务|继续这个任务|current task|existing task|continue current|update this task)/iu,
    ),
    has_amendment_intent: hasPattern(
      text,
      /(修改|更新|增加|删除|改成|加上|去掉|变更|约束|限制|交付|预算|工作区|workspace|constraint|deliverable|budget|append|remove|change|update|amend)/iu,
    ),
    clarification_required: Boolean(session.receptionist.clarification_required),
  };
}

export function resolveEntryAction(
  signals: EntryActionIntentSignals,
  _session: SessionView,
): EntryActionResolution {
  if (signals.is_slash_command) {
    return {
      route: signals.session_status === "RUNNING" ? "amend_existing_task" : "intake_new_task",
      target_task_id: signals.bound_task_id,
      clarification_required: false,
      guidance_reason: "slash_command_bypass",
      clarification_question: null,
    };
  }

  if (signals.session_status !== "RUNNING" || !signals.bound_task_id) {
    return {
      route: "intake_new_task",
      target_task_id: null,
      clarification_required: false,
      guidance_reason: "not_running_or_unbound",
      clarification_question: null,
    };
  }

  if (signals.clarification_required) {
    const clarificationAnswer = resolveClarificationAnswer(signals.normalized_message);
    if (clarificationAnswer === "current_task") {
      return {
        route: "amend_existing_task",
        target_task_id: signals.bound_task_id,
        clarification_required: false,
        guidance_reason: "clarification_answer_current_task",
        clarification_question: null,
      };
    }
    if (clarificationAnswer === "new_task") {
      return {
        route: "intake_new_task",
        target_task_id: null,
        clarification_required: false,
        guidance_reason: "clarification_answer_new_task",
        clarification_question: null,
      };
    }
    return {
      route: "clarify_target",
      target_task_id: signals.bound_task_id,
      clarification_required: true,
      guidance_reason: "clarification_still_required",
      clarification_question: buildClarificationQuestion(signals.bound_task_id),
    };
  }

  if (signals.explicit_task_id) {
    if (signals.explicit_task_id === signals.bound_task_id) {
      return {
        route: "amend_existing_task",
        target_task_id: signals.bound_task_id,
        clarification_required: false,
        guidance_reason: "explicit_bound_task_id_match",
        clarification_question: null,
      };
    }
    return {
      route: "clarify_target",
      target_task_id: signals.bound_task_id,
      clarification_required: true,
      guidance_reason: "explicit_task_id_conflict",
      clarification_question: buildClarificationQuestion(signals.bound_task_id),
    };
  }

  if (signals.has_new_task_intent && !signals.has_existing_task_intent) {
    return {
      route: "clarify_target",
      target_task_id: signals.bound_task_id,
      clarification_required: true,
      guidance_reason: "new_task_intent_during_running",
      clarification_question: buildClarificationQuestion(signals.bound_task_id),
    };
  }

  if (signals.has_existing_task_intent && !signals.has_new_task_intent) {
    return {
      route: "amend_existing_task",
      target_task_id: signals.bound_task_id,
      clarification_required: false,
      guidance_reason: "explicit_existing_task_intent",
      clarification_question: null,
    };
  }

  if (signals.has_amendment_intent) {
    return {
      route: "amend_existing_task",
      target_task_id: signals.bound_task_id,
      clarification_required: false,
      guidance_reason: "amendment_intent_detected",
      clarification_question: null,
    };
  }

  return {
    route: "clarify_target",
    target_task_id: signals.bound_task_id,
    clarification_required: true,
    guidance_reason: "ambiguous_running_input",
    clarification_question: buildClarificationQuestion(signals.bound_task_id),
  };
}

export function buildEntryActionGuidance(
  resolution: EntryActionResolution,
  session: SessionView,
): EntryActionGuidance {
  const missing: EntryActionGuidance["missing_configuration"] = [];
  if (!session.draft.task_goal.trim()) {
    missing.push("task_goal");
  }
  if (!session.draft.project_id.trim()) {
    missing.push("project_id");
  }
  if (!session.draft.workspace_root.trim()) {
    missing.push("workspace_root");
  }
  if (session.draft.budget.max_token_cost <= 0 || session.draft.budget.max_execution_time_seconds <= 0) {
    missing.push("budget");
  }
  if (!session.draft.risk_level.trim()) {
    missing.push("risk_level");
  }

  const nextStep =
    resolution.route === "clarify_target"
      ? "await_clarification"
      : resolution.route === "amend_existing_task"
        ? "collect_amendment"
        : "collect_intake";

  return {
    missing_configuration: missing,
    next_step: nextStep,
  };
}
