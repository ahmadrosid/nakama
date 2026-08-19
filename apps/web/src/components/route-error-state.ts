export interface RouteErrorState {
  failed: boolean;
  resetKey?: string;
}

export function routeErrorStateFromResetKey(
  resetKey: string | undefined,
  state: RouteErrorState
): Partial<RouteErrorState> | null {
  if (resetKey === state.resetKey) {
    return null;
  }

  return { failed: false, resetKey };
}
