import { describe, expect, mock, test } from "bun:test";
import { createBaileysLogger } from "./baileys-logger";

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
});
