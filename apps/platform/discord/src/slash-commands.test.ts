import { describe, expect, test } from "bun:test";
import { buildSlashCommands } from "./slash-commands";

describe("buildSlashCommands", () => {
  test("registers allow with a required user option", () => {
    const commands = buildSlashCommands();
    expect(commands.map((command) => command.name)).toContain("allow");

    const allow = commands.find((command) => command.name === "allow");
    expect(allow).toBeDefined();

    const userOption = allow!
      .toJSON()
      .options?.find((option: { name?: string }) => option.name === "user");
    expect(userOption).toMatchObject({
      name: "user",
      required: true,
      type: 6,
    });
  });
});
