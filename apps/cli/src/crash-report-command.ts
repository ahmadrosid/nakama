import {
  currentCrashReportConsent,
  getLastCrashReportPath,
  loadCachedCrashReportConfig,
  parseSentryDsn,
  readLastCrashReport,
  readPendingCrashReports,
  resolveCrashReportDsn,
  toSentryEvent,
} from "@nakama/core/crash-report";

export function isCrashReportShowCommand(
  argv = process.argv.slice(2)
): boolean {
  return argv[0] === "report" && argv[1] === "--show";
}

/**
 * Prints the exact payload, not a description of it. Anything this project says about
 * what crash reporting sends should be checkable by the person running it, without
 * reading the source.
 */
export async function runCrashReportShow(): Promise<void> {
  const config = await loadCachedCrashReportConfig();
  const consent = await currentCrashReportConsent();
  const dsn = resolveCrashReportDsn(config);
  const [report, pending] = await Promise.all([
    readLastCrashReport(),
    readPendingCrashReports(),
  ]);

  console.log(`Consent:   ${consent}`);
  console.log(
    `Sends to:  ${dsn ? (parseSentryDsn(dsn)?.endpoint ?? dsn) : "nowhere (no DSN)"}`
  );
  console.log(`Install id: ${config.installId ?? "not created yet"}`);
  console.log(`Held, unsent: ${pending.length}`);
  console.log(`Stored at: ${getLastCrashReportPath()}`);
  console.log("");

  if (!report) {
    console.log("No report recorded yet. Nothing has been prepared to send.");
    return;
  }

  console.log("Last report, scrubbed, as stored:");
  console.log(JSON.stringify(report, null, 2));

  if (!dsn) {
    return;
  }

  console.log("");
  console.log("Posted to the ingest as:");
  console.log(
    JSON.stringify(
      toSentryEvent(report, { installId: config.installId }),
      null,
      2
    )
  );
}
