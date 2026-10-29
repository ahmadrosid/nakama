import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  AgentGroupMessage,
  AgentGroupRun,
  AgentGroupSessionDetail,
  AgentGroupThreadDetail,
} from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { client } from "@/lib/client";
import { useGroupConversation } from "./use-agent-groups";

const RUN: AgentGroupRun = {
  activity: null,
  speakerProfileId: "a",
  stopping: false,
};

const reply: AgentGroupMessage = {
  authorProfileId: "a",
  content: "hello",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: 1,
  threadReplies: 0,
};

const spies: { mockRestore: () => void }[] = [];

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(() => root.unmount());
  }

  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }

  document.body.innerHTML = "";
});

const CREATED = "2026-01-01T00:00:00.000Z";

function sessionDetail(
  run: AgentGroupRun | null = RUN
): AgentGroupSessionDetail {
  return {
    group: {
      avatarVersion: null,
      brief: "",
      createdAt: CREATED,
      handles: {},
      id: "g",
      lastMessage: null,
      memberIds: ["a"],
      name: "Team",
    },
    messages: [reply],
    run,
    session: {
      active: run !== null,
      createdAt: CREATED,
      groupId: "g",
      id: "s",
      pinned: false,
      title: "Chat",
      updatedAt: CREATED,
    },
    threadRunIds: [],
  };
}

function threadDetail(run: AgentGroupRun | null = RUN): AgentGroupThreadDetail {
  return { messages: [reply], profileId: "a", rootId: 1, run };
}

async function until(check: () => boolean) {
  for (let tries = 0; tries < 100 && !check(); tries += 1) {
    await act(() => Bun.sleep(20));
  }
}

/** What a test reads from the mounted hook, for the main chat or a thread. */
interface Probed {
  conversation?: {
    data?: { messages: AgentGroupMessage[] };
    send: (content: string, documents?: DocumentAttachment[]) => Promise<void>;
  };
}

/** Mounts the hook for the main chat, or with `rootId` for a thread. */
async function mount(rootId?: number) {
  const state: Probed = {};

  function Probe() {
    state.conversation =
      rootId === undefined
        ? useGroupConversation("g", "s")
        : useGroupConversation("g", "s", rootId);

    return null;
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const container = document.createElement("div");
  document.body.append(container);

  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await until(() => state.conversation?.data !== undefined);

  return state;
}

const contents = (state: Awaited<ReturnType<typeof mount>>) =>
  state.conversation?.data?.messages.map((message) => message.content);

test.each([
  ["main chat", undefined],
  ["thread", 1],
])(
  "in the %s, a poll during a send keeps the pending message",
  async (_, rootId) => {
    const sent = Promise.withResolvers<void>();

    const fetchSpy =
      rootId === undefined
        ? spyOn(client, "getAgentGroupSession").mockResolvedValue(
            sessionDetail()
          )
        : spyOn(client, "getAgentGroupThread").mockResolvedValue(
            threadDetail()
          );

    spies.push(
      fetchSpy,
      spyOn(client, "sendAgentGroupMessage").mockReturnValue(sent.promise),
      spyOn(client, "sendAgentGroupThreadMessage").mockReturnValue(sent.promise)
    );

    const state = await mount(rootId);
    const fetches = fetchSpy.mock.calls.length;
    let sending!: Promise<void>;

    await act(async () => {
      sending = state.conversation!.send("more?");
    });

    // Longer than one poll while agents reply.
    await act(() => Bun.sleep(1700));

    expect(fetchSpy.mock.calls.length).toBe(fetches);
    expect(contents(state)).toEqual(["hello", "more?"]);

    sent.resolve();
    await act(() => sending);
  },
  5000
);

test("a failed send rejects, and the refresh rolls the message back", async () => {
  spies.push(
    spyOn(client, "getAgentGroupSession").mockResolvedValue(
      sessionDetail(null)
    ),
    spyOn(client, "sendAgentGroupMessage").mockRejectedValue(
      new Error("offline")
    )
  );

  const state = await mount();

  await act(async () => {
    await expect(state.conversation!.send("hi")).rejects.toThrow("offline");
  });
  await until(() => contents(state)?.length === 1);

  expect(contents(state)).toEqual(["hello"]);
});

test("a pasted image does not show as a file while it is sent", async () => {
  const sent = Promise.withResolvers<void>();

  spies.push(
    spyOn(client, "getAgentGroupSession").mockResolvedValue(
      sessionDetail(null)
    ),
    spyOn(client, "sendAgentGroupMessage").mockReturnValue(sent.promise)
  );

  const state = await mount();
  let sending!: Promise<void>;

  await act(async () => {
    sending = state.conversation!.send("look", [
      { data: "AAAA", filename: "image.png", mediaType: "image/png" },
      { data: "AAAA", filename: "notes.txt", mediaType: "text/plain" },
    ]);
  });
  await until(() => contents(state)?.length === 2);

  expect(state.conversation?.data?.messages.at(-1)?.files).toEqual([
    "notes.txt",
  ]);

  sent.resolve();
  await act(() => sending);
});
