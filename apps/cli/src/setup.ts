import * as readline from "node:readline/promises";
import {
  type Component,
  CURSOR_MARKER,
  type Focusable,
  Input,
  matchesKey,
  ProcessTerminal,
  TuiAltScreen,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { NakamaApiError, NakamaClient } from "@nakama/client";
import {
  getUserConfigPath,
  type ProviderModelOption,
  promptForProviderConfig,
  type UserProviderName,
} from "@nakama/core";
import { formatCliDisplayPath, isCliVerbose } from "./display-path";
import { printLine } from "./terminal-safe";

export class LoginForm implements Component, Focusable {
  focused = true;
  private server = new Input({ prompt: "Server URL: " });
  private email = new Input({ prompt: "Email: " });
  private password = new Input();
  private field = 0;
  private busy = false;
  private closed = false;
  private message = "";

  constructor(
    serverUrl: string,
    private readonly authenticate: (
      serverUrl: string,
      email: string,
      password: string
    ) => Promise<unknown>,
    private readonly renderAgain: () => void,
    private readonly finish: (error?: Error) => void
  ) {
    this.server.setValue(serverUrl);
    this.server.handleInput("\x05");
  }

  invalidate(): void {}

  clear(): void {
    // Replace inputs as well as values: Input retains undo and kill-ring history.
    this.email = new Input({ prompt: "Email: " });
    this.password = new Input();
  }

  render(width: number): string[] {
    this.server.focused = this.focused && this.field === 0;
    this.email.focused = this.focused && this.field === 1;
    const passwordMarker =
      this.focused && this.field === 2
        ? `${CURSOR_MARKER}\x1b[7m \x1b[27m`
        : "";
    return [
      "Connect to Nakama",
      ...(this.server.focused
        ? this.server.render(Math.max(1, width))
        : [`Server URL: ${this.server.getValue()}`]),
      "",
      ...(this.email.focused
        ? this.email.render(Math.max(1, width))
        : [`Email: ${this.email.getValue()}`]),
      // Never render the password Input, even briefly or while handling paste.
      `Password: ${this.password.getValue() ? "[hidden]" : ""}${passwordMarker}`,
      "",
      this.busy
        ? "Connecting…"
        : this.message || "Tab: next field · Enter: connect · Esc: cancel",
    ].map((line) => truncateToWidth(line, Math.max(1, width)));
  }

  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.clear();
      this.closed = true;
      this.finish(new Error("Login cancelled."));
    } else if (this.busy) {
      return;
    } else if (matchesKey(data, "tab")) {
      this.field = (this.field + 1) % 3;
    } else if (matchesKey(data, "shift+tab")) {
      this.field = (this.field + 2) % 3;
    } else if (matchesKey(data, "enter")) {
      if (this.field < 2) {
        this.field += 1;
      } else {
        void this.submit();
      }
    } else {
      [this.server, this.email, this.password][this.field].handleInput(data);
    }
    this.renderAgain();
  }

  private async submit(): Promise<void> {
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(this.server.getValue().trim());
    } catch {
      this.message =
        "Enter a valid HTTPS server URL (HTTP is allowed for localhost).";
      this.field = 0;
      return;
    }
    if (!(this.email.getValue().trim() && this.password.getValue())) {
      this.message = "Enter your email and password.";
      return;
    }
    this.busy = true;
    try {
      await this.authenticate(
        serverUrl,
        this.email.getValue().trim(),
        this.password.getValue()
      );
      this.clear();
      this.closed = true;
      this.finish();
    } catch (error) {
      this.password = new Input();
      this.message =
        error instanceof NakamaApiError && error.status === 401
          ? "Incorrect email or password. Try again."
          : "Could not log in. Check the server and credential store, then retry.";
    } finally {
      this.busy = false;
      if (!this.closed) {
        this.renderAgain();
      }
    }
  }
}

export async function promptRemoteLogin(
  serverUrl: string,
  authenticate: (
    serverUrl: string,
    email: string,
    password: string,
    signal?: AbortSignal
  ) => Promise<unknown>,
  signal?: AbortSignal
): Promise<void> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new Error(
      "Login requires an interactive terminal. Run the CLI login command first."
    );
  }
  signal?.throwIfAborted();
  // Login fields must not be captured by pi-tui's optional diagnostic logs.
  const logKeys = [
    "PI_TUI_WRITE_LOG",
    "PI_TUI_DEBUG",
    "PI_TUI_DEBUG_REDRAW",
  ] as const;
  const previousLogs = logKeys.map((key) => process.env[key]);
  for (const key of logKeys) {
    delete process.env[key];
  }
  const tui = new TuiAltScreen(new ProcessTerminal());
  const done = Promise.withResolvers<void>();
  const controller = new AbortController();
  let pendingLogin: Promise<unknown> | undefined;
  const form = new LoginForm(
    serverUrl,
    (url, email, password) => {
      pendingLogin = authenticate(url, email, password, controller.signal);
      return pendingLogin;
    },
    () => tui.requestRender(),
    (error) => {
      if (error) {
        done.reject(error);
      } else {
        done.resolve();
      }
    }
  );
  const abort = () => done.reject(new Error("Login cancelled."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    tui.addChild(form);
    tui.setFocus(form);
    tui.start();
    await done.promise;
  } finally {
    controller.abort();
    await pendingLogin?.catch(() => {});
    form.clear();
    tui.stop({ preserveScreen: true });
    signal?.removeEventListener("abort", abort);
    for (const [index, key] of logKeys.entries()) {
      const value = previousLogs[index];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(new Error("Terminal does not support raw mode"));
      return;
    }

    stdout.write(prompt);

    const wasPaused = stdin.isPaused();
    let rawModeEnabled = false;

    const restoreStdin = () => {
      if (rawModeEnabled) {
        stdin.setRawMode(false);
        rawModeEnabled = false;
      }
      if (wasPaused) {
        stdin.pause();
      }
      stdin.removeListener("data", onData);
    };

    let password = "";

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          // Enter or EOF
          restoreStdin();
          stdout.write("\n");
          resolve(password);
          return;
        }

        if (char === "\u0003") {
          // Ctrl+C
          restoreStdin();
          stdout.write("\n");
          process.exit(130);
        }

        if (char === "\u007f" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write("\b \b");
          }
        } else if (char >= " " && char <= "~") {
          // Printable ASCII
          password += char;
          stdout.write("*");
        }
      }
    };

    try {
      stdin.setRawMode(true);
      rawModeEnabled = true;
      stdin.resume();
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
    } catch (error) {
      restoreStdin();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function ensureUserConfiguredViaCli(
  client: NakamaClient
): Promise<boolean> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return false;
  }

  console.log("Nakama admin setup\n");
  console.log("No admin user found. Let's create one.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let email: string;
  try {
    email = await rl.question("Email: ");
  } finally {
    rl.close();
  }

  const password = await readPassword("Password: ");
  const confirmPassword = await readPassword("Confirm password: ");

  if (password !== confirmPassword) {
    console.log("Passwords do not match.");
    return false;
  }

  if (password.length < 8) {
    console.log("Password must be at least 8 characters.");
    return false;
  }

  try {
    const result = await client.setupUser(email, password);
    client.setAuthToken(result.token);
    console.log("Admin user created successfully.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printLine(`Failed to create admin user: ${message}`);
    return false;
  }
}

export async function ensureProviderConfiguredViaCli(
  client: NakamaClient
): Promise<boolean> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return false;
  }

  const catalog = await client.getModels();
  const modelHelpers = createModelHelpers(catalog.models);

  console.log("Nakama setup\n");
  console.log("No API key found. Let's configure one.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const config = await promptForProviderConfig({
      question: (prompt) => rl.question(prompt),
      writeLine: (line) => printLine(line),
      ...modelHelpers,
    });

    const instance = config.providers[0]!;
    const model =
      instance.customModels?.find((entry) => entry.default)?.id ??
      instance.customModels?.[0]?.id ??
      modelHelpers.getDefaultModel(instance.type);

    const result = await client.configureProvider({
      apiKey: instance.apiKey,
      baseUrl: instance.baseUrl,
      customModels: instance.customModels,
      displayName:
        instance.type === "openai_compatible" ? instance.label : undefined,
      hostMode: instance.hostMode,
      model,
      provider: instance.type,
    });

    printLine(
      `\nProvider configured (${result.provider}, ${result.currentModel}).`
    );
    console.log(
      `Saved to ${formatCliDisplayPath(getUserConfigPath(), isCliVerbose())}\n`
    );

    return true;
  } finally {
    rl.close();
  }
}

function createModelHelpers(models: ProviderModelOption[]) {
  return {
    getDefaultModel: (provider: UserProviderName) => {
      const providerModels = models.filter(
        (model) => model.provider === provider
      );
      return (
        providerModels.find((model) => model.default)?.id ??
        providerModels[0]?.id ??
        "gpt-5.4"
      );
    },
    getModelById: (modelId: string) =>
      models.find((model) => model.id === modelId),
    getModelsForProvider: (provider: UserProviderName) =>
      models.filter((model) => model.provider === provider),
  };
}

export function isLocalServer(serverUrl: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(serverUrl).hostname
  );
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Server URL must not contain credentials, query parameters or a fragment."
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalServer(url.href))
  ) {
    throw new Error("Remote servers require HTTPS.");
  }
  return url.href.replace(/\/$/, "");
}

export function parseConnectionArgs(argv = process.argv.slice(2)): {
  command?: "login" | "logout";
  serverUrl?: string;
} {
  let serverUrl: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg !== "--server" && !arg.startsWith("--server=")) {
      continue;
    }
    const value =
      arg === "--server" ? argv[index + 1] : arg.slice("--server=".length);
    if (arg === "--server") {
      index += 1;
    }
    if (!value || value.startsWith("--")) {
      throw new Error("Pass --server https://your-nakama-server.");
    }
    serverUrl = normalizeServerUrl(value);
  }
  const command =
    argv[0] === "login" || argv[0] === "logout" ? argv[0] : undefined;
  return { command, serverUrl };
}

export async function createRemoteConnection(
  serverUrl: string,
  options: {
    fetch?: typeof fetch;
    secretStore?: Pick<typeof Bun.secrets, "get" | "set" | "delete">;
  } = {}
) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const store = options.secretStore ?? Bun.secrets;
  const key = { name: baseUrl, service: "nakama-cli" };
  let tokens: { session: string; csrf: string } | null = null;
  let saved: string | null;
  try {
    saved = await store.get(key);
  } catch {
    throw new Error(
      "Cannot access the OS credential store. Unlock your keychain or start your secret service, then retry."
    );
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (validCookieToken(parsed.session) && validCookieToken(parsed.csrf)) {
        tokens = { csrf: parsed.csrf, session: parsed.session };
      }
    } catch {
      // An obsolete or corrupt entry is replaced at the next login.
    }
  }

  const fetchImpl = options.fetch ?? fetch;
  let loginSignal: AbortSignal | undefined;
  const client = new NakamaClient({
    baseUrl,
    fetch: (async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      if (
        url.origin !== new URL(baseUrl).origin ||
        !url.href.startsWith(`${baseUrl}/`)
      ) {
        throw new Error("Refusing to send the session to another server.");
      }
      const headers = new Headers(init?.headers);
      headers.delete("Authorization");
      headers.delete("Cookie");
      headers.delete("X-CSRF-Token");
      if (tokens) {
        headers.set(
          "Cookie",
          `nakama_session=${tokens.session}; nakama_csrf=${tokens.csrf}`
        );
        if (
          !["GET", "HEAD", "OPTIONS"].includes(
            (init?.method ?? "GET").toUpperCase()
          )
        ) {
          headers.set("X-CSRF-Token", tokens.csrf);
        }
      }
      const response = await fetchImpl(input, {
        ...init,
        headers,
        redirect: "error",
        signal:
          loginSignal ??
          init?.signal ??
          (url.pathname.includes("/v1/auth/")
            ? AbortSignal.timeout(30_000)
            : undefined),
      });
      if (response.status === 401 && tokens) {
        tokens = null;
        await store.delete(key);
        throw new NakamaApiError(
          "Session expired. Run the CLI again to log in.",
          401,
          url.pathname
        );
      }
      if (response.ok && url.pathname.endsWith("/v1/auth/login")) {
        const cookies = new Bun.CookieMap(
          response.headers
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; ")
        );
        const session = cookies.get("nakama_session");
        const csrf = cookies.get("nakama_csrf");
        if (!(validCookieToken(session) && validCookieToken(csrf))) {
          throw new Error("Server did not return a valid login session.");
        }
        tokens = { csrf, session };
      }
      return response;
    }) as typeof fetch,
  });

  return {
    client,
    async login(email: string, password: string, signal?: AbortSignal) {
      loginSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : undefined;
      let user;
      try {
        user = await client.login(email, password);
      } finally {
        loginSignal = undefined;
      }
      try {
        signal?.throwIfAborted();
        await store.set({ ...key, value: JSON.stringify(tokens) });
        signal?.throwIfAborted();
      } catch {
        await client.logout().catch(() => {});
        tokens = null;
        await store.delete(key);
        throw new Error(
          "Could not save the session in the OS credential store. Login was cancelled."
        );
      }
      return user;
    },
    async logout() {
      try {
        if (tokens) {
          await client.logout();
        }
      } catch (error) {
        if (!(error instanceof NakamaApiError && error.status === 401)) {
          throw new Error(
            "Local session removed, but server logout failed. The remote session may remain active."
          );
        }
      } finally {
        tokens = null;
        await store.delete(key);
      }
    },
  };
}

function validCookieToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}
