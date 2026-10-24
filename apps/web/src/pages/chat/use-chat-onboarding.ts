import { parseUserContext, renderUserContext } from "@nakama/core/user-context";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useProfileQuery } from "@/hooks/use-app-queries";
import { useComposioToolkits } from "@/hooks/use-composio";
import { useOrgMemory } from "@/hooks/use-org-memory";
import {
  useAssignSkillMutation,
  useHistorySessionsQuery,
  useUserContextQuery,
  useWriteUserContextMutation,
} from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";
import { pathForPage } from "@/lib/navigation";
import {
  orgMemoryHasFacts,
  readSetupChecklist,
  type SetupChecklistRow,
  type StoredSetupChecklist,
  setupChecklistRows,
  shouldShowGoalPrompt,
  writeSetupChecklist,
} from "@/pages/chat/chat-page.shared";

export type Onboarding = ReturnType<typeof useOnboarding>;

/**
 * The empty chat's first-run path: goal prompt → finding steps → checklist.
 * Waits for its reads, so a returning user never sees the prompt flash
 * before their history loads.
 */
type OnboardingPhase = "checklist" | "finding" | "idle";

function pickOnboardingView(input: {
  enabled: boolean;
  hasChecklist: boolean;
  phase: OnboardingPhase;
  showGoal: boolean;
}): "checklist" | "finding" | "goal" | null {
  if (!input.enabled) {
    return null;
  }

  if (input.phase === "finding") {
    return "finding";
  }

  if (input.phase === "checklist" && input.hasChecklist) {
    return "checklist";
  }

  return input.showGoal ? "goal" : null;
}

/** Waits for both reads, so a returning user never sees the prompt flash. */
function useShowGoalPrompt(enabled: boolean, profileId: string): boolean {
  const { activeOrg } = useAuth();

  const userContext = useUserContextQuery({
    includeContent: true,
    orgId: activeOrg?.id ?? null,
  });

  const history = useHistorySessionsQuery(profileId);

  return (
    enabled &&
    userContext.isSuccess &&
    !history.isLoading &&
    !history.error &&
    shouldShowGoalPrompt({
      orgRole: activeOrg?.role,
      sessions: history.data,
      userContext: userContext.data.content,
    })
  );
}

/** Reads only what the stored items need, so a toolkit-free list skips Composio. */
function useSetupChecklistRows(
  stored: StoredSetupChecklist | null,
  profileId: string
): SetupChecklistRow[] {
  const { activeOrg } = useAuth();
  const kinds = new Set(stored?.items.map((item) => item.kind));

  const toolkits = useComposioToolkits({
    enabled: kinds.has("connect_toolkit"),
  });

  const profile = useProfileQuery(kinds.has("enable_skill") ? profileId : null);

  const orgMemory = useOrgMemory(
    activeOrg?.role === "admin" && kinds.has("write_context")
      ? activeOrg.id
      : null
  );

  if (!stored) {
    return [];
  }

  return setupChecklistRows(stored, {
    assignedSkillIds: profile.data?.skills.map((skill) => skill.id) ?? [],
    connectedToolkits:
      toolkits.data?.userConnections
        .filter((connection) => connection.status === "connected")
        .map((connection) => connection.toolkitSlug) ?? [],
    orgHasFacts: orgMemoryHasFacts(orgMemory.data?.content),
  });
}

/** What each checklist button does; members write context in About you. */
function useSetupActions(profileId: string, openAboutYou: () => void) {
  const { activeOrg } = useAuth();
  const navigate = useNavigate();
  const assignSkill = useAssignSkillMutation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = (row: SetupChecklistRow) => {
    setError(null);

    if (row.item.kind === "connect_toolkit") {
      navigate(pathForPage("composio"));
    } else if (row.item.kind === "write_context") {
      if (activeOrg?.role === "admin") {
        navigate(pathForPage("organization"));
      } else {
        openAboutYou();
      }
    } else {
      setBusyKey(row.key);
      assignSkill.mutate(
        { profileId, skillId: row.item.skillId },
        {
          onError: (cause) => setError(formatError(cause)),
          onSettled: () => setBusyKey(null),
        }
      );
    }
  };

  return { busyKey, error, runAction };
}

/** The empty chat's first-run path: goal prompt → finding steps → checklist. */
export function useOnboarding({
  cognito,
  cognitoLocked,
  isEmptyState,
  profileId,
  readOnlySession,
}: {
  cognito: boolean;
  cognitoLocked: boolean;
  isEmptyState: boolean;
  profileId: string;
  readOnlySession: boolean;
}) {
  const { health } = useAppContext();
  const { activeOrg, user } = useAuth();

  const enabled =
    health?.onboardingEnabled === true &&
    isEmptyState &&
    !cognito &&
    !cognitoLocked &&
    !readOnlySession;

  const orgId = activeOrg?.id ?? "";
  const userId = user?.id ?? "";
  const [goalSkipped, setGoalSkipped] = useState(false);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);
  const [phase, setPhase] = useState<OnboardingPhase>("idle");
  const [aboutYouOpen, setAboutYouOpen] = useState(false);

  const [stored, setStored] = useState(() => readSetupChecklist(orgId, userId));

  const userContext = useUserContextQuery({
    includeContent: true,
    orgId: activeOrg?.id ?? null,
  });

  const writeUserContext = useWriteUserContextMutation();
  const showGoal = useShowGoalPrompt(enabled && !goalSkipped, profileId);
  const rows = useSetupChecklistRows(stored, profileId);
  const actions = useSetupActions(profileId, () => setAboutYouOpen(true));

  const update = (next: StoredSetupChecklist) => {
    if (orgId && userId) {
      writeSetupChecklist(orgId, userId, next);
    }

    setStored(next);
  };

  // A failed or empty checklist must never block the chat.
  const loadChecklist = async () => {
    setPhase("finding");

    try {
      const response = await client.getSetupChecklist(profileId);

      if (response.items.length > 0) {
        update({
          done: [],
          goal: response.goal,
          items: response.items,
          skipped: [],
        });
        setPhase("checklist");

        return;
      }
    } catch {
      // Falls through to the plain chat below.
    }

    setPhase("idle");
  };

  const view = pickOnboardingView({
    enabled,
    hasChecklist: stored !== null,
    phase,
    showGoal,
  });

  const showPill =
    enabled && view === null && rows.some((row) => row.status === "open");

  return {
    aboutYouOpen,
    actionError: actions.error,
    busyKey: actions.busyKey,
    finish: () => setPhase("idle"),
    goal: stored?.goal ?? pendingGoal,
    goalError: writeUserContext.error
      ? formatError(writeUserContext.error)
      : null,
    markAboutYouSaved: () =>
      stored && update({ ...stored, done: [...stored.done, "context:org"] }),
    openChecklist: () => setPhase("checklist"),
    pill: showPill
      ? {
          done: rows.filter((row) => row.status === "done").length,
          total: rows.length,
        }
      : null,
    rows,
    runAction: actions.runAction,
    saveGoal: (goal: string) => {
      const { answers, extra } = parseUserContext(userContext.data?.content);

      setPendingGoal(goal);
      writeUserContext.mutate(
        renderUserContext({ ...answers, help: goal }, extra),
        { onSuccess: () => void loadChecklist() }
      );
    },
    savingGoal: writeUserContext.isPending,
    setAboutYouOpen,
    skipGoal: () => setGoalSkipped(true),
    skipItem: (row: SetupChecklistRow) =>
      stored && update({ ...stored, skipped: [...stored.skipped, row.key] }),
    view,
  };
}
