export interface AutomationWorkerConfig {
  serverUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

export function loadConfig(): AutomationWorkerConfig {
  return {
    serverUrl: process.env.NAKAMA_SERVER_URL?.trim() || "http://127.0.0.1:4310",
    pollIntervalMs: parseInt(process.env.NAKAMA_AUTOMATION_POLL_INTERVAL_MS ?? "30000", 10),
    heartbeatIntervalMs: parseInt(process.env.NAKAMA_AUTOMATION_HEARTBEAT_INTERVAL_MS ?? "15000", 10),
  };
}
