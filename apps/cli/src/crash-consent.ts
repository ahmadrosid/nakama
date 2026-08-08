import * as readline from "node:readline/promises";
import {
  clearPendingCrashReports,
  currentCrashReportConsent,
  flushPendingCrashReports,
  readPendingCrashReports,
  saveCrashReportConsent,
} from "@nakama/core/crash-report";

/**
 * Asked on the first crash rather than at install, so an install that never breaks is
 * never interrupted. The server and the workers have no terminal to ask on, which is why
 * they hold the report and the CLI is the one that asks.
 */
export async function runCrashConsentPromptIfNeeded(): Promise<void> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return;
  }

  if ((await currentCrashReportConsent()) !== "unset") {
    return;
  }

  const pending = await readPendingCrashReports();

  if (pending.length === 0) {
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let answer = "";

  try {
    const subject =
      pending.length === 1 ? "an error" : `${pending.length} errors`;
    console.log(`\nNakama hit ${subject} recently.`);
    console.log(
      "The report carries a scrubbed error message and stack (no chat content)."
    );
    console.log("Inspect with: nakama report --show");
    answer = (await rl.question("Send it so the bug gets fixed? [y/N/never] "))
      .trim()
      .toLowerCase();
  } catch {
    return;
  } finally {
    rl.close();
  }

  if (answer === "y" || answer === "yes") {
    await saveCrashReportConsent("granted");
    const sent = await flushPendingCrashReports();
    console.log(
      sent > 0 ? "Sent. Thanks." : "Saved. Reports will be sent from now on."
    );
    return;
  }

  if (answer === "never") {
    await saveCrashReportConsent("denied");
    await clearPendingCrashReports();
    console.log("Crash reports are off. Nothing will be sent.");
    return;
  }

  // A plain no drops what was held but leaves the question open, so a later crash can ask
  // again. "never" is the answer that stops it for good.
  await clearPendingCrashReports();
}
