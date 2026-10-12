export function composerActions(state: {
  canStop: boolean;
  hasContent: boolean;
}) {
  return { showStop: state.canStop, showSubmit: state.hasContent };
}
