interface TurnState {
  assignedToolIds: Set<string>;
  createdToolIds: Set<string>;
  toolBuildApproved: boolean;
  turnIndex: number;
}

export class SuperBotSessionState {
  private readonly turns = new Map<string, TurnState>();

  beginTurn(sessionId: string): void {
    const previous = this.turns.get(sessionId);
    this.turns.set(sessionId, {
      assignedToolIds: new Set(),
      createdToolIds: new Set(),
      toolBuildApproved: false,
      turnIndex: (previous?.turnIndex ?? 0) + 1,
    });
  }

  markToolCreated(sessionId: string | undefined, toolId: string): void {
    if (!sessionId) {
      return;
    }

    this.turnFor(sessionId).createdToolIds.add(toolId);
  }

  canUpdateProfile(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return true;
    }

    return (this.turns.get(sessionId)?.turnIndex ?? 0) >= 2;
  }

  canCreateTool(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return true;
    }

    const turn = this.turns.get(sessionId);
    return (turn?.turnIndex ?? 0) >= 2 && turn?.toolBuildApproved === true;
  }

  approveToolBuild(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false;
    }

    const turn = this.turns.get(sessionId);
    if (!turn || turn.turnIndex < 2) {
      return false;
    }

    turn.toolBuildApproved = true;
    return true;
  }

  canAssignTool(sessionId: string | undefined, toolId: string): boolean {
    if (!sessionId) {
      return true;
    }

    const turn = this.turns.get(sessionId);

    if (!turn?.createdToolIds.has(toolId)) {
      return true;
    }

    return !turn.assignedToolIds.has(toolId);
  }

  markToolAssigned(sessionId: string | undefined, toolId: string): void {
    if (!sessionId) {
      return;
    }

    this.turnFor(sessionId).assignedToolIds.add(toolId);
  }

  clearSession(sessionId: string): void {
    this.turns.delete(sessionId);
  }

  private turnFor(sessionId: string): TurnState {
    let turn = this.turns.get(sessionId);

    if (!turn) {
      turn = {
        assignedToolIds: new Set(),
        createdToolIds: new Set(),
        toolBuildApproved: false,
        turnIndex: 1,
      };
      this.turns.set(sessionId, turn);
    }

    return turn;
  }
}

export const TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE =
  "This tool was already assigned to a profile in this turn. Assign it to another profile on a later message or from the dashboard.";

export const PROFILE_UPDATE_CONFIRMATION_MESSAGE =
  "Wait for the user to confirm the draft in a later message before calling update_profile.";

export const TOOL_CREATION_CONFIRMATION_MESSAGE =
  "Wait for the user to confirm the build, call approve_tool_build, then call create_tool.";
