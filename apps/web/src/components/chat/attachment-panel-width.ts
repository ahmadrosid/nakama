export const ATTACHMENT_PANEL_MIN_WIDTH = 320;
const DESKTOP_MAX_WIDTH_RATIO = 0.75;
const TABLET_MAX_WIDTH_RATIO = 0.5;
/** Tailwind `lg` — below this viewport, cap panel width more aggressively. */
const TABLET_MAX_VIEWPORT_WIDTH = 1024;

export function attachmentPanelMaxWidthRatio(viewportWidth: number): number {
  return viewportWidth < TABLET_MAX_VIEWPORT_WIDTH
    ? TABLET_MAX_WIDTH_RATIO
    : DESKTOP_MAX_WIDTH_RATIO;
}

export function clampAttachmentPanelWidth(
  width: number,
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : TABLET_MAX_VIEWPORT_WIDTH,
): number {
  const maxWidth = Math.floor(viewportWidth * attachmentPanelMaxWidthRatio(viewportWidth));
  return Math.min(maxWidth, Math.max(ATTACHMENT_PANEL_MIN_WIDTH, width));
}
