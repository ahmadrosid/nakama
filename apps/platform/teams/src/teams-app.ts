import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { App, ExpressAdapter } from "@microsoft/teams.apps";
import type { TeamsConfigFile } from "@nakama/core/teams-config";
import { z } from "zod";
import type { TeamsActivity } from "./chat-handler";

/** Microsoft's endpoints for token issuing and signing keys. */
type TeamsCloud = NonNullable<
  NonNullable<ConstructorParameters<typeof App>[0]>["cloud"]
>;

export interface TeamsAppDeps {
  /**
   * Only tests set this, to serve their own signing keys. The worker never
   * passes it, so production always verifies against Microsoft's public cloud.
   */
  cloud?: TeamsCloud;
  config: Pick<TeamsConfigFile, "clientId" | "clientSecret" | "tenantId">;
  /** Runs after Teams has been answered, so a long turn never delays the ACK. */
  onActivity: (activity: TeamsActivity) => Promise<void>;
}

export interface TeamsAppHandle {
  address: string;
  port: number;
  send: (conversationId: string, text: string) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Where replies go. The SDK sends the bot's token with each one and would read
 * SERVICE_URL from the environment when this is not passed.
 */
const TEAMS_SERVICE_URL = "https://smba.trafficmanager.net/teams";

/** Turns allowed to run or wait at once, across every chat. */
const MAX_BACKGROUND_TURNS = 16;

/** Turns one chat may have running or waiting, so it cannot take every slot. */
const MAX_TURNS_PER_CONVERSATION = 4;

type LogLine = (...message: unknown[]) => void;

/**
 * The SDK logs request and error objects that can carry the client secret, an
 * Authorization header or Microsoft's raw response. Only its message text, and
 * only warnings and errors, reaches the worker log.
 */
export function createSafeLogger() {
  const keepText =
    (write: (text: string) => void): LogLine =>
    (...message) => {
      const text = z.string().safeParse(message[0]);

      if (text.success) {
        write(`[teams-sdk] ${text.data}`);
      }
    };

  const ignore: LogLine = () => {};

  const logger = {
    child: () => logger,
    debug: ignore,
    error: keepText((text) => console.error(text)),
    info: ignore,
    log: ignore,
    trace: ignore,
    warn: keepText((text) => console.warn(text)),
  };

  return logger;
}

/** Reads the fields this slice acts on from an SDK message activity. */
function toTeamsActivity(activity: {
  conversation: { conversationType?: string; id: string; tenantId?: string };
  from: { aadObjectId?: string; role?: string };
  id?: string;
  text?: string;
}): TeamsActivity {
  return {
    conversationId: activity.conversation.id,
    conversationType: activity.conversation.conversationType ?? "",
    id: activity.id ?? "",
    isBot: activity.from.role === "bot",
    senderId: activity.from.aadObjectId ?? "",
    tenantId: activity.conversation.tenantId ?? "",
    text: activity.text ?? "",
  };
}

/** The SDK app, with every option the environment could otherwise decide. */
export function createTeamsSdkApp(
  deps: Pick<TeamsAppDeps, "cloud" | "config">,
  adapter: ExpressAdapter,
  logger: ReturnType<typeof createSafeLogger>
): App {
  return new App({
    clientId: deps.config.clientId,
    clientSecret: deps.config.clientSecret,
    cloud: deps.cloud,
    // Explicit, so DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS in the
    // environment cannot turn service token validation off.
    dangerouslyAllowUnauthenticatedRequests: false,
    httpServerAdapter: adapter,
    logger,
    serviceUrl: TEAMS_SERVICE_URL,
    tenantId: deps.config.tenantId,
  });
}

export async function startTeamsApp(
  deps: TeamsAppDeps
): Promise<TeamsAppHandle> {
  const logger = createSafeLogger();
  // A server we own, so we choose the interface. The adapter attaches its own
  // request handler to it; its start() would listen on every interface.
  const server = createServer();
  const adapter = new ExpressAdapter(server, { logger });
  const app = createTeamsSdkApp(deps, adapter, logger);

  let running = 0;
  const perConversation = new Map<string, number>();

  app.on("message", ({ activity }) => {
    const conversationId = activity.conversation.id;
    const waiting = perConversation.get(conversationId) ?? 0;

    // Thrown, so the SDK answers 500 instead of acknowledging a message that
    // would never run.
    if (
      running >= MAX_BACKGROUND_TURNS ||
      waiting >= MAX_TURNS_PER_CONVERSATION
    ) {
      throw new Error("The Teams worker is busy; refused an activity.");
    }

    running += 1;
    perConversation.set(conversationId, waiting + 1);

    deps
      .onActivity(toTeamsActivity(activity))
      .catch((error: Error) => {
        console.error("[teams] turn failed:", error.message);
      })
      .finally(() => {
        running -= 1;
        const left = (perConversation.get(conversationId) ?? 1) - 1;

        if (left > 0) {
          perConversation.set(conversationId, left);
        } else {
          perConversation.delete(conversationId);
        }
      });

    return Promise.resolve();
  });

  // Registers the authenticated messaging route without opening a listener.
  await app.initialize();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  // SAFETY: A TCP listener reports an AddressInfo once listen() has resolved;
  // only pipes and Unix sockets report a string.
  const { address, port } = server.address() as AddressInfo;

  return {
    address,
    port,
    send: async (conversationId, text) => {
      await app.send(conversationId, text);
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
