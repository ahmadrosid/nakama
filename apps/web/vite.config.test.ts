import { expect, test } from "bun:test";
import { resolveConfig } from "vite";

const configFile = `${import.meta.dir}/vite.config.ts`;

test("allows only the hostname from the public web URL", async () => {
  const previous = process.env.NAKAMA_WEB_PUBLIC_URL;

  try {
    process.env.NAKAMA_WEB_PUBLIC_URL = "https://nakama.example.com:3003/app";

    const configured = await resolveConfig(
      { configFile, logLevel: "silent" },
      "serve"
    );

    expect(configured.server.allowedHosts).toEqual(["nakama.example.com"]);

    delete process.env.NAKAMA_WEB_PUBLIC_URL;

    const unset = await resolveConfig(
      { configFile, logLevel: "silent" },
      "serve"
    );

    expect(unset.server.allowedHosts).toEqual([]);
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_WEB_PUBLIC_URL;
    } else {
      process.env.NAKAMA_WEB_PUBLIC_URL = previous;
    }
  }
});
