import { afterEach, expect, test } from "bun:test";
import { withMswCassette } from "./llm-msw-cassette";
import {
  closePluginPackageRegistry,
  pluginPackage,
} from "./plugin-package-fixture";

afterEach(closePluginPackageRegistry);

test("closing the plugin registry isolates cassette replay and allows registry reuse", async () => {
  const source = pluginPackage({ "nakama.plugin.json": '{"version":"1.0.0"}' });
  const registryUrl = `https://registry.npmjs.org/${source.packageName}`;
  expect((await (await fetch(registryUrl)).json()).name).toBe(
    source.packageName
  );
  closePluginPackageRegistry();

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
  await withMswCassette(
    "gemini-signed-tool-continuation",
    async () => {
      const first = await fetch(url, { method: "POST" });
      expect(first.status).toBe(200);
      expect(
        (await first.json()).candidates[0].content.parts[0].functionCall.name
      ).toBe("read_probe");
      const second = await fetch(url, { method: "POST" });
      expect(second.status).toBe(200);
      expect((await second.json()).candidates[0].content.parts[0].text).toBe(
        "PROBE-7319"
      );
    },
    { mode: "replay", url }
  );

  pluginPackage({ "nakama.plugin.json": '{"version":"1.0.0"}' });
  const metadata = await (await fetch(registryUrl)).json();
  expect(metadata.name).toBe(source.packageName);
  const archive = await fetch(metadata.versions["1.0.0"].dist.tarball);
  expect(archive.status).toBe(200);
  expect((await archive.arrayBuffer()).byteLength).toBeGreaterThan(0);
});
