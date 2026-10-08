/**
 * Stop must stay reachable while a turn is running. It used to be hidden as soon
 * as the composer had text, so typing the next message swapped Stop for Queue and
 * left no way to cancel: the turn kept the session and every send came back 409.
 */
export function composerActions(state: {
  canStop: boolean;
  hasContent: boolean;
}) {
  return { showStop: state.canStop, showSubmit: state.hasContent };
}
