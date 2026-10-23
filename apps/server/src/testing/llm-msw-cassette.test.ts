import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { withMswCassette } from "./llm-msw-cassette";

test.each(["text/event-stream; charset=utf-8", ""])(
  "SSE cassettes preserve text and content type (%s) and reject changed requests",
  async (contentType) => {
    const cassettesDir = await mkdtemp(join(tmpdir(), "nakama-sse-"));

    const body =
      'event: response.output_text.delta\ndata: {"delta":"hello","user":"synthetic-account"}\n\ndata: [DONE]\n\n';

    const endpoint = Bun.serve({
      fetch: () =>
        new Response(new TextEncoder().encode(body), {
          headers: { "Content-Type": contentType },
        }),
      port: 0,
    });

    const url = endpoint.url.toString();

    const options = {
      cassettesDir,
      matchRequest: isDeepStrictEqual,
      redactResponse: (response: z.infer<ReturnType<typeof z.json>>) =>
        z.string().parse(response).replaceAll("synthetic-account", "redacted"),
      url,
    };

    const request = { model: "synthetic", tools: [{ name: "drive__read" }] };

    const send = (input = request) =>
      fetch(url, { body: JSON.stringify(input), method: "POST" });

    try {
      for (const mode of ["record", "replay"] as const) {
        await withMswCassette(
          "sse",
          async () => {
            const response = await send();

            if (contentType) {
              expect(response.headers.get("content-type")).toBe(contentType);
            } else {
              // Bun may supply a default MIME type for a headerless response.
              expect(response.headers.get("content-type")).not.toContain(
                "application/json"
              );
            }

            expect(await response.text()).toBe(
              body.replaceAll("synthetic-account", "redacted")
            );
          },
          { ...options, mode }
        );
        expect(
          await Bun.file(join(cassettesDir, "sse.json")).text()
        ).not.toContain("synthetic-account");
        await endpoint.stop();
      }

      await expect(
        withMswCassette(
          "sse",
          async () => {
            const response = await send({ ...request, tools: [] });
            expect(response.status).toBe(500);
          },
          { ...options, mode: "replay" }
        )
      ).rejects.toThrow("unused exchanges");
    } finally {
      await endpoint.stop();
      await rm(cassettesDir, { force: true, recursive: true });
    }
  }
);
