import { create } from "zustand";

export interface RunningTurnsState {
  endTurn: (sessionId: string) => void;
  /**
   * Sessions this tab has a turn in flight for, detached ones included.
   *
   * The server knows this too, but only the page knows it the moment a turn
   * starts: the session list is fetched on its own schedule and would not look
   * again until something told it to, which is the whole problem this solves.
   */
  sessionIds: readonly string[];
  startTurn: (sessionId: string) => void;
}

export const useRunningTurnsStore = create<RunningTurnsState>((set) => ({
  endTurn: (sessionId) =>
    set((state) => ({
      sessionIds: state.sessionIds.filter((id) => id !== sessionId),
    })),
  sessionIds: [],
  startTurn: (sessionId) =>
    set((state) =>
      state.sessionIds.includes(sessionId)
        ? state
        : { sessionIds: [...state.sessionIds, sessionId] }
    ),
}));
