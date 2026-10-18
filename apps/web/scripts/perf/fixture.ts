import { resolve, sep } from "node:path";
import type {
  ChatMessage,
  ProfileDetail,
  SessionMessagesResponse,
  StreamEvent,
} from "@nakama/core/contract";

const date = "2026-01-01T12:00:00.000Z";

export const fixture = { chunks: 120, intervalMs: 30, turns: 300 };

const profile: ProfileDetail = {
  createdAt: date,
  hasAvatar: false,
  id: "perf",
  isDefault: true,
  isSuper: false,
  mcpServerCount: 0,
  mcpServers: [],
  model: "ollama::fixture",
  name: "Performance fixture",
  skills: [],
  soulActive: false,
  systemPrompt: "Synthetic fixture",
  toolCount: 0,
  tools: [],
  updatedAt: date,
};

export function history(id: string): SessionMessagesResponse {
  const messages: ChatMessage[] = [];

  for (let i = 0; i < fixture.turns; i++) {
    const toolCallId = `${id}-tool-${i}`;
    messages.push(
      {
        content: `Question ${id} ${i}: inspect the synthetic report.`,
        role: "user",
      },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { path: `fixture-${i}.ts` },
            id: toolCallId,
            name: "read_file",
          },
        ],
      },
      {
        content: JSON.stringify({ lines: ["const value = 42;"], ok: true }),
        name: "read_file",
        role: "tool",
        toolCallId,
      },
      {
        content: `## Report ${id} ${i}\n\nA **deterministic** report with [local reference](#report).\n\n- First result\n- Second result\n\n| Item | Value |\n| --- | --- |\n| Seed | ${i} |\n\n\`\`\`typescript\nconst value = ${i};\nconsole.log(value);\n\`\`\`\n\nEnd of report ${id} ${i}.`,
        role: "assistant",
      }
    );
  }

  return {
    channel: "web",
    messageMeta: [],
    messages,
    model: profile.model,
    questionnaire: null,
    todos: [],
  };
}

export function startFixture(dist: string) {
  const root = resolve(dist);
  const histories = new Map(["a", "b"].map((id) => [id, history(id)]));
  const streams = { cancelled: 0, completed: 0, emitted: 0, started: 0 };
  let released = false;
  const unexpected: string[] = [];

  const sessions = ["a", "b"].map((id) => ({
    active: false,
    channel: "web",
    createdAt: date,
    id,
    messageCount: fixture.turns * 4,
    pinned: false,
    preview: null,
    profileId: "perf",
    title: `Fixture ${id.toUpperCase()}`,
    updatedAt: date,
  }));

  const responses = new Map(
    Object.entries({
      "/health": {
        apiVersion: "v1",
        composioAvailable: false,
        composioConfigured: false,
        ok: true,
        providerConfigured: true,
        userConfigured: true,
        version: "perf",
      },
      "/v1/auth/me": {
        activeOrgId: "perf-org",
        email: "perf@example.invalid",
        id: "perf-user",
        isPlatformAdmin: false,
        name: "Fixture",
      },
      "/v1/auth/orgs": {
        orgs: [
          {
            createdAt: date,
            id: "perf-org",
            name: "Fixture",
            role: "owner",
            slug: "fixture",
            updatedAt: date,
          },
        ],
      },
      "/v1/automations": { automations: [] },
      "/v1/models": {
        currentProviderId: "fixture",
        displayName: "Fixture",
        models: [
          {
            default: true,
            id: "fixture",
            name: "Fixture",
            provider: "ollama",
            providerId: "fixture",
          },
        ],
        provider: "ollama",
        providers: [
          {
            createdAt: date,
            hasApiKey: false,
            id: "fixture",
            label: "Fixture",
            modelCount: 1,
            type: "ollama",
          },
        ],
      },
      "/v1/profiles": { profiles: [profile] },
      "/v1/profiles/perf": { profile },
      "/v1/sessions": { nextCursor: null, sessions },
      "/v1/settings/thinking": { effort: "low", enabled: false },
      "/v1/settings/timezone": { timezone: "UTC" },
      "/v1/skills": { skills: [] },
      "/v1/timezones": { timezones: ["UTC"] },
    })
  );

  const server = Bun.serve({
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const match = /^\/v1\/sessions\/([ab])\/(messages|status)$/.exec(path);

      if (match) {
        const id = match[1]!;

        if (match[2] === "status") {
          return Response.json({ active: false });
        }

        const data = histories.get(id)!;

        if (request.method === "GET") {
          return Response.json(data);
        }

        if (request.method === "POST") {
          data.messages.push({ content: "Run synthetic stream", role: "user" });

          streams.started++;
          let timer: ReturnType<typeof setInterval>;
          let index = 0;
          let reply = "";

          const bodyStream = new ReadableStream({
            cancel() {
              clearInterval(timer);
              streams.cancelled++;
            },
            start(controller) {
              const emit = (event: StreamEvent) =>
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
                );

              timer = setInterval(() => {
                if (index === 3 && !released) {
                  return;
                }

                const delta = `Synthetic chunk ${index}. **value**\n\n`;
                reply += delta;
                emit({ delta, type: "chunk" });
                streams.emitted++;
                index++;

                if (index === fixture.chunks) {
                  clearInterval(timer);
                  data.messages.push({ content: reply, role: "assistant" });
                  emit({ reply, type: "done" });
                  streams.completed++;
                  controller.close();
                }
              }, fixture.intervalMs);
            },
          });

          return new Response(bodyStream, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "text/event-stream",
            },
          });
        }
      }

      if (request.method === "GET" && responses.has(path)) {
        return Response.json(responses.get(path));
      }

      if (path.startsWith("/v1/") || path === "/health") {
        unexpected.push(`${request.method} ${path}`);

        return Response.json(
          { error: `No fixture for ${path}` },
          { status: 501 }
        );
      }

      const filePath = resolve(root, `.${path}`);

      if (!filePath.startsWith(root + sep)) {
        return new Response(null, { status: 403 });
      }

      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }

      if (!path.includes(".")) {
        return new Response(Bun.file(resolve(root, "index.html")));
      }

      return new Response(null, { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  return {
    release: () => {
      released = true;
    },
    server,
    streams,
    unexpected,
  };
}
