import { DEMO_LOGIN_HOST } from "@nakama/core/demo-login";

export function isDemoLoginHost(
  hostname: string = typeof window === "undefined"
    ? ""
    : window.location.hostname
): boolean {
  return hostname.trim().toLowerCase() === DEMO_LOGIN_HOST;
}
