export interface RouteErrorState {
  error?: string;
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

  return { error: undefined, failed: false, resetKey };
}
