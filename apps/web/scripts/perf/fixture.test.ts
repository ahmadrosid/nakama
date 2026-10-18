import { expect, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
import { fixture, history, startFixture } from "./fixture";

test("long fixtures are deterministic and contain Markdown and tool history", () => {
  const a = history("a");
  expect(a).toEqual(history("a"));
  expect(a.messages).toHaveLength(fixture.turns * 4);
  expect(a.messages.filter((message) => message.role === "tool")).toHaveLength(
    fixture.turns
  );
  expect(a.messages.at(-1)?.content).toContain("```typescript");
  expect(a.messages.at(-1)?.content).not.toEqual(
    history("b").messages.at(-1)?.content
  );
});

test("fixture streams through the real client and persists only in the sending chat", async () => {
  const { server, streams, unexpected, release } = startFixture("/tmp");
  const client = new NakamaClient({ baseUrl: server.url.origin });

  try {
    const beforeB = await client.getSessionMessages("b");
    let chunks = 0;

    const reply = client
      .createChatSession("a", "web")
      .sendStream("Run synthetic stream", () => {
        chunks++;

        if (chunks === 3) {
          release();
        }
      });

    expect(await reply).toContain("Synthetic chunk 119.");
    expect(chunks).toBe(fixture.chunks);
    expect(streams).toEqual({
      cancelled: 0,
      completed: 1,
      emitted: fixture.chunks,
      started: 1,
    });
    expect(await client.getSessionMessages("b")).toEqual(beforeB);
    expect((await client.getSessionMessages("a")).messages).toHaveLength(
      fixture.turns * 4 + 2
    );
    expect(unexpected).toEqual([]);
    expect((await fetch(`${server.url.origin}/v1/not-seeded`)).status).toBe(
      501
    );
    expect(unexpected).toHaveLength(1);
  } finally {
    server.stop(true);
  }
}, 10_000);
