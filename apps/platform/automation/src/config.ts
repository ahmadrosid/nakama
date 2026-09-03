export const AUTOMATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface AutomationWorkerConfig {
  heartbeatIntervalMs: number;
  serverUrl: string;
}

export function loadConfig(): AutomationWorkerConfig {
  return {
    heartbeatIntervalMs: Number.parseInt(
      process.env.NAKAMA_AUTOMATION_HEARTBEAT_INTERVAL_MS ?? "15000",
      10
    ),
    serverUrl: process.env.NAKAMA_SERVER_URL?.trim() || "http://127.0.0.1:4310",
  };
}
