const levels = { debug: 10, error: 40, info: 20, silent: 50, warn: 30 };

export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  fields: Record<string, string | number | boolean> = {}
): void {
  const configured = process.env.NAKAMA_LOG_LEVEL ?? "info";
  const threshold =
    Object.entries(levels).find(([name]) => name === configured)?.[1] ??
    levels.info;
  if (levels[level] < threshold) {
    return;
  }
  const time = new Date().toISOString();
  const line =
    process.env.NAKAMA_LOG_FORMAT === "json"
      ? JSON.stringify({ ...fields, level, message, time })
      : `${time} ${level.toUpperCase()} ${message} ${JSON.stringify(fields)}`;
  console.log(line);
}
