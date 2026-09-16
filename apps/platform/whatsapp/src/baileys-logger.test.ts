import { describe, expect, mock, test } from "bun:test";
import {
  createBaileysLogger,
  installBaileysConsoleRedaction,
} from "./baileys-logger";

describe("Baileys logger", () => {
  test("suppresses nonfatal init query timeouts", () => {
    const writeError = mock(() => {});
    const logger = createBaileysLogger(writeError);

    logger.error(
      {
        err: {
          isBoom: true,
          message: "Timed Out",
        },
      },
      "unexpected error in 'init queries'"
    );

    expect(writeError).not.toHaveBeenCalled();
  });

  test("reports other Baileys errors", () => {
    const writeError = mock(() => {});
    const logger = createBaileysLogger(writeError);
    const context = { err: new Error("Connection Closed") };

    logger.error(context, "error in validating connection");

    expect(writeError).toHaveBeenCalledWith(
      context,
      "error in validating connection"
    );
  });

  test("redacts Signal session objects written directly to the console", () => {
    const info = mock(() => {});
    const warn = mock(() => {});
    const consoleTarget = { info, warn };
    const session = {
      currentRatchet: { rootKey: Buffer.from("private-key-material") },
    };
    const restore = installBaileysConsoleRedaction(consoleTarget);

    consoleTarget.info("Closing session:", session);
    consoleTarget.warn("Session already closed", session);
    consoleTarget.info("ordinary log", session);

    expect(info.mock.calls[0]).toHaveLength(1);
    expect(info.mock.calls[0]).not.toContain(session);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0]).not.toContain(session);
    expect(info).toHaveBeenNthCalledWith(2, "ordinary log", session);

    restore();
    consoleTarget.info("Closing session:", session);
    expect(info).toHaveBeenNthCalledWith(3, "Closing session:", session);
  });
});
