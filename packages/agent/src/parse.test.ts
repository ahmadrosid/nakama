import { expect, test } from "bun:test";
import { parseAutomationResponse } from "./parse";

test("parseAutomationResponse preserves email delivery", () => {
  const automation = parseAutomationResponse(
    JSON.stringify({
      delivery: {
        channel: "email",
        notifyOn: "both",
        to: "user@example.com",
      },
      description: "Send a daily summary",
      name: "Daily digest",
      steps: [],
      trigger: { cron: "0 8 * * *", timezone: "UTC", type: "schedule" },
    }),
    {
      prompt:
        "Summarize the latest updates and send the results to user@example.com",
      tools: [],
    }
  );

  expect(automation.delivery).toEqual({
    channel: "email",
    notifyOn: "both",
    to: "user@example.com",
  });
});
