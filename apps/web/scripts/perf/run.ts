import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixture, startFixture } from "./fixture";

const [baseline, candidate, output = "/tmp/nakama-web-perf.json"] = process.argv
  .slice(2)
  .filter((arg) => arg !== "--diagnostics");

if (!(baseline && candidate)) {
  throw new Error(
    "Usage: bun run perf <baseline-dist> <candidate-dist> [output.json] [--diagnostics]"
  );
}

const diagnostics = process.argv.includes("--diagnostics");

const chromium = process.env.CHROMIUM ?? "chromium";

const rounds = Number(process.env.PERF_ROUNDS ?? 3);

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error("PERF_ROUNDS must be positive");
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function sample(dist: string, scenario: string) {
  const { server, streams, unexpected, release } = startFixture(dist);
  const userData = await mkdtemp(join(tmpdir(), "nakama-perf-"));

  const browser = Bun.spawn(
    [
      chromium,
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${userData}`,
      "about:blank",
    ],
    { stderr: "pipe", stdout: "ignore" }
  );

  let socket: WebSocket | undefined;
  const errors: unknown[] = [];

  try {
    const deadline = Date.now() + 15_000;
    const portFile = join(userData, "DevToolsActivePort");

    while (
      !(
        (await Bun.file(portFile).exists()) &&
        /^\d+\n/.test(await Bun.file(portFile).text())
      )
    ) {
      if (Date.now() > deadline) {
        throw new Error("Chromium did not start within 15 seconds");
      }

      await pause(50);
    }

    const port = (await Bun.file(portFile).text()).split("\n")[0];

    const response = await fetch(`http://127.0.0.1:${port}/json`);

    if (!response.ok) {
      throw new Error(
        `Chromium target discovery failed: HTTP ${response.status}`
      );
    }

    // SAFETY: Chromium owns this loopback endpoint and returns page targets.
    const targets = (await response.json()) as {
      webSocketDebuggerUrl: string;
    }[];

    socket = new WebSocket(targets[0]!.webSocketDebuggerUrl);
    await new Promise<void>((done, reject) => {
      socket!.onopen = () => done();
      socket!.onerror = reject;
    });
    let id = 0;

    const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (reason: Error) => void }
    >();

    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));

      if (message.id) {
        const task = pending.get(message.id);
        pending.delete(message.id);

        if (message.error) {
          task?.reject(new Error(JSON.stringify(message.error)));
        } else {
          task?.resolve(message.result);
        }
      }

      if (message.method === "Runtime.exceptionThrown") {
        errors.push(message.params.exceptionDetails);
      }
    };

    const send = (
      method: string,
      params: Record<
        string,
        | string
        | number
        | boolean
        | string[]
        | { block: boolean; urlPattern: string }[]
      > = {}
    ): Promise<any> =>
      new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { reject, resolve });
        socket!.send(JSON.stringify({ id: key, method, params }));
        setTimeout(() => {
          if (pending.delete(key)) {
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 15_000).unref();
      });

    const evaluate = async (expression: string) => {
      const result = await send("Runtime.evaluate", {
        awaitPromise: true,
        expression,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails));
      }

      return result.result.value;
    };

    const until = async (expression: string) => {
      const end = Date.now() + 15_000;

      while (!(await evaluate(expression))) {
        if (Date.now() > end) {
          throw new Error(
            `Timed out: ${expression}\n${await evaluate("document.body.innerText")}\nUnexpected requests: ${unexpected}`
          );
        }

        await pause(50);
      }
    };

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Network.enable");
    // Only the fixture origin is reachable by the page. No provider or customer API.
    await send("Network.setBlockedURLs", {
      urlPatterns: [
        { block: false, urlPattern: `${server.url.origin}/*` },
        { block: true, urlPattern: "http://*/*" },
        { block: true, urlPattern: "https://*/*" },
      ],
      urls: ["https://*", "http://*"],
    });
    await send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 1000,
      mobile: false,
      width: 1440,
    });
    await send("Performance.enable");

    if (diagnostics) {
      await send("Page.addScriptToEvaluateOnNewDocument", {
        source:
          "window.__commits = 0; window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {supportsFiber:true,inject:()=>1,onCommitFiberRoot:()=>window.__commits++,onCommitFiberUnmount:()=>{}};",
      });
    }

    await send("Page.navigate", { url: `${server.url.origin}/chat/perf/a` });
    await until(
      "document.body?.innerText.includes('Report a') && !!document.querySelector('textarea')"
    );
    await evaluate("document.fonts.ready");

    // Warm both long histories and syntax highlighting before any sample.
    const switchTo = async (target: string) => {
      await evaluate(
        `document.querySelector('a[href="/chat/perf/${target}"]').click()`
      );
      await until(`document.body.innerText.includes('Report ${target}')`);
      await pause(250);
    };

    await switchTo("b");
    await switchTo("a");
    await pause(500);

    const metrics = async () =>
      Object.fromEntries(
        (await send("Performance.getMetrics")).metrics.map(
          (entry: { name: string; value: number }) => [entry.name, entry.value]
        )
      );

    if (scenario !== "switch") {
      await evaluate("document.querySelector('textarea').focus()");
      await send("Input.insertText", { text: "Run synthetic stream" });
      await send("Input.dispatchKeyEvent", {
        code: "Enter",
        key: "Enter",
        type: "keyDown",
        windowsVirtualKeyCode: 13,
      });
      await send("Input.dispatchKeyEvent", {
        code: "Enter",
        key: "Enter",
        type: "keyUp",
        windowsVirtualKeyCode: 13,
      });
      const end = Date.now() + 5000;

      while (streams.emitted < 3) {
        if (Date.now() > end) {
          throw new Error(
            `Stream did not start: ${await evaluate("document.body.innerText")}`
          );
        }

        await pause(20);
      }

      if (scenario === "cross-chat") {
        await switchTo("b");
      }
    }

    await evaluate(
      `window.__commits = 0; window.__latencies = []; window.__longTasks = []; window.__observer = new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration))); window.__observer.observe({type:'longtask',buffered:false}); document.addEventListener('input', () => { const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__latencies.push(performance.now()-start))); });`
    );
    const before = await metrics();
    const startChunks = streams.emitted;

    if (scenario !== "switch" && (startChunks !== 3 || streams.started !== 1)) {
      throw new Error("Stream gate did not hold exactly three warmup chunks");
    }

    const startTime = performance.now();
    release();
    const switches: number[] = [];

    if (scenario === "switch") {
      for (const target of ["b", "a", "b", "a", "b", "a"]) {
        switches.push(
          await evaluate(
            `new Promise((resolve, reject) => { const start = performance.now(); const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('switch timeout')); }, 5000); const observer = new MutationObserver(() => { if (document.body.innerText.includes('Report ${target}')) { observer.disconnect(); clearTimeout(timeout); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()-start))); } }); observer.observe(document.getElementById('root'), {childList:true, subtree:true, characterData:true}); document.querySelector('a[href="/chat/perf/${target}"]').click(); })`
          )
        );
        await pause(100);
      }
    } else {
      if (scenario === "typing") {
        await evaluate("document.querySelector('textarea').focus()");

        for (const character of "Typing during a synthetic streaming reply.") {
          await send("Input.insertText", { text: character });
          await pause(30);
        }

        await until("window.__latencies.length === 42");
      }

      const end = Date.now() + 10_000;

      while (!streams.completed) {
        if (Date.now() > end) {
          throw new Error("Stream did not complete");
        }

        await pause(20);
      }

      await pause(100);

      if (streams.cancelled || streams.emitted !== fixture.chunks) {
        throw new Error("Stream fixture was not fully consumed");
      }

      if (scenario === "cross-chat") {
        await until(
          "location.pathname.endsWith('/b') && document.body.innerText.includes('Report b') && !document.body.innerText.includes('Synthetic chunk')"
        );
      }

      if (scenario === "typing") {
        await until(
          "document.querySelector('textarea').value === 'Typing during a synthetic streaming reply.' && document.body.innerText.includes('Synthetic chunk 119.')"
        );
      }
    }

    const after = await metrics();

    const observation = await evaluate(
      "({inputFrameMs:window.__latencies,longTasksMs:window.__longTasks,commits:window.__commits})"
    );

    if (diagnostics && observation.commits === 0) {
      throw new Error("React commit diagnostics are unsupported by this build");
    }

    if (unexpected.length || errors.length) {
      throw new Error(JSON.stringify({ errors, unexpected }));
    }

    return diagnostics
      ? { commits: observation.commits, scenario, streams: { ...streams } }
      : {
          heapEndBytes: after.JSHeapUsedSize,
          heapStartBytes: before.JSHeapUsedSize,
          inputFrameMs: observation.inputFrameMs,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          longTasksMs: observation.longTasksMs,
          measuredChunks: streams.emitted - startChunks,
          scenario,
          scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
          streams: { ...streams },
          switchFrameMs: switches,
          taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
          wallMs: performance.now() - startTime,
        };
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: 999_999, method: "Browser.close" }));
    }

    await Promise.race([browser.exited, pause(2000)]);
    socket?.close();

    if (browser.exitCode === null) {
      browser.kill();
    }

    await browser.exited;
    server.stop(true);
    await rm(userData, { force: true, recursive: true });
  }
}

const results = [];

for (let round = 0; round < rounds; round++) {
  for (const label of round % 2
    ? ["candidate", "baseline"]
    : ["baseline", "candidate"]) {
    for (const scenario of ["cross-chat", "typing", "switch"]) {
      console.error(`${round + 1}/${rounds} ${label}: ${scenario}`);
      results.push({
        label,
        round: round + 1,
        ...(await sample(
          resolve(label === "baseline" ? baseline : candidate),
          scenario
        )),
      });
    }
  }
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const summary = [];

if (!diagnostics) {
  for (const label of ["baseline", "candidate"]) {
    for (const scenario of ["cross-chat", "typing", "switch"]) {
      const samples = results.filter(
        (row) => row.label === label && row.scenario === scenario
      );

      summary.push({
        inputFrameP95Ms:
          scenario === "typing"
            ? median(samples.map((row) => percentile(row.inputFrameMs, 0.95)!))
            : null,
        label,
        layoutMs: median(samples.map((row) => row.layoutMs!)),
        scenario,
        scriptMs: median(samples.map((row) => row.scriptMs!)),
        switchFrameMedianMs:
          scenario === "switch"
            ? median(samples.map((row) => median(row.switchFrameMs!)))
            : null,
        taskMs: median(samples.map((row) => row.taskMs!)),
      });
    }
  }
}

const builds = [];

for (const dist of [baseline, candidate]) {
  const hash = createHash("sha256");

  const files = [
    ...new Bun.Glob("**/*").scanSync({
      cwd: dist,
      onlyFiles: true,
    }),
  ]
    .filter(
      (file) =>
        file === "index.html" || file === "sw.js" || file.startsWith("assets/")
    )
    .sort();

  if (!files.includes("index.html") || files.length < 2) {
    throw new Error(`No production assets in ${dist}`);
  }

  for (const file of files) {
    hash.update(file);
    // Hashing runs after measurement. Read one file at a time in sorted order.
    hash.update(readFileSync(join(dist, file)));
  }

  builds.push({ dist: resolve(dist), runtimeSha256: hash.digest("hex") });
}

const report = {
  baseline: resolve(baseline),
  builds,
  bun: Bun.version,
  candidate: resolve(candidate),
  chromium: Bun.spawnSync([chromium, "--version"]).stdout.toString().trim(),
  cpu: cpus()[0]?.model,
  fixture,
  mode: diagnostics ? "commit-diagnostics" : "production-timings",
  platform: `${process.platform}/${process.arch}`,
  results,
  rounds,
  summary,
  viewport: "1440x1000@1",
};

await Bun.write(output, JSON.stringify(report, null, 2) + "\n");

console.log(output);
