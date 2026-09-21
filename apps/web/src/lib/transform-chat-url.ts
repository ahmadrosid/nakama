import { defaultUrlTransform, type UrlTransform } from "streamdown";

export const transformChatUrl: UrlTransform = (url, key, node) => {
  const safeUrl = defaultUrlTransform(url, key, node);
  if (!safeUrl || key !== "src" || node.tagName !== "img") {
    return safeUrl;
  }
  try {
    const resolved = new URL(safeUrl, window.location.origin);
    if (!["https:", "http:", "data:", "blob:"].includes(resolved.protocol)) {
      return "";
    }
    if (
      resolved.origin !== window.location.origin &&
      (resolved.protocol === "https:" || resolved.protocol === "http:")
    ) {
      return `/v1/chat/images/proxy?url=${encodeURIComponent(resolved.href)}`;
    }
  } catch {
    return "";
  }
  return safeUrl;
};
