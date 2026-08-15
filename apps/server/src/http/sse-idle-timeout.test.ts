import { describe, expect, test } from "bun:test";
import {
  disableBunIdleTimeoutForLongHeldRequest,
  disableBunIdleTimeoutForSse,
  isLongHeldAutomationRunRequest,
  isSseResponse,
} from "./sse-idle-timeout";

describe("isSseResponse", () => {
  test("matches text/event-stream Content-Type", () => {
    expect(
      isSseResponse(
        new Response(null, {
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    ).toBe(true);
  });

  test("matches text/event-stream with charset", () => {
    expect(
      isSseResponse(
        new Response(null, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        })
      )
    ).toBe(true);
  });

  test("does not match ordinary JSON", () => {
    expect(
      isSseResponse(
        new Response(null, {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        })
      )
    ).toBe(false);
  });

  test("does not match missing Content-Type", () => {
    expect(isSseResponse(new Response(null))).toBe(false);
  });
});

describe("disableBunIdleTimeoutForSse", () => {
  test("calls server.timeout(request, 0) for SSE responses", () => {
    const request = new Request(
      "http://127.0.0.1:4310/v1/sessions/abc/messages",
      {
        method: "POST",
      }
    );
    const response = new Response(null, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
    const calls: Array<{ request: Request; seconds: number }> = [];

    disableBunIdleTimeoutForSse(request, response, {
      timeout(req, seconds) {
        calls.push({ request: req, seconds });
      },
    });

    expect(calls).toEqual([{ request, seconds: 0 }]);
  });

  test("leaves non-SSE responses on the default idle timeout", () => {
    const request = new Request("http://127.0.0.1:4310/health");
    const response = new Response("ok");
    let called = false;

    disableBunIdleTimeoutForSse(request, response, {
      timeout() {
        called = true;
      },
    });

    expect(called).toBe(false);
  });
});

describe("isLongHeldAutomationRunRequest", () => {
  test("matches public and internal run POSTs", () => {
    expect(
      isLongHeldAutomationRunRequest(
        new Request("http://127.0.0.1:4310/v1/automations/auto_1/run", {
          method: "POST",
        })
      )
    ).toBe(true);
    expect(
      isLongHeldAutomationRunRequest(
        new Request(
          "http://127.0.0.1:4310/v1/internal/automations/auto_1/run",
          { method: "POST" }
        )
      )
    ).toBe(true);
  });

  test("does not match run listing or other methods", () => {
    expect(
      isLongHeldAutomationRunRequest(
        new Request("http://127.0.0.1:4310/v1/automations/auto_1/runs")
      )
    ).toBe(false);
    expect(
      isLongHeldAutomationRunRequest(
        new Request("http://127.0.0.1:4310/v1/automations/auto_1/run")
      )
    ).toBe(false);
  });
});

describe("disableBunIdleTimeoutForLongHeldRequest", () => {
  test("calls server.timeout(request, 0) for automation runs", () => {
    const request = new Request(
      "http://127.0.0.1:4310/v1/automations/auto_1/run",
      { method: "POST" }
    );
    const calls: Array<{ request: Request; seconds: number }> = [];

    disableBunIdleTimeoutForLongHeldRequest(request, {
      timeout(req, seconds) {
        calls.push({ request: req, seconds });
      },
    });

    expect(calls).toEqual([{ request, seconds: 0 }]);
  });

  test("leaves non-run requests on the default idle timeout", () => {
    const request = new Request("http://127.0.0.1:4310/health");
    let called = false;

    disableBunIdleTimeoutForLongHeldRequest(request, {
      timeout() {
        called = true;
      },
    });

    expect(called).toBe(false);
  });
});
