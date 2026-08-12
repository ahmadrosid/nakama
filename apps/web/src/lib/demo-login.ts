export const DEMO_LOGIN_HOST = "demo.getnakama.cloud";
export const DEMO_LOGIN_EMAIL = "demo@getnakama.cloud";
export const DEMO_LOGIN_PASSWORD = "demo1234";

export function isDemoLoginHost(
  hostname: string = typeof window === "undefined"
    ? ""
    : window.location.hostname
): boolean {
  return hostname.trim().toLowerCase() === DEMO_LOGIN_HOST;
}
