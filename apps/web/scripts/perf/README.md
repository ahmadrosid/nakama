# Web runtime benchmark

Run the production chat UI with local synthetic HTTP/SSE fixtures. No Nakama
server, provider key, customer data, or LLM is needed. The fixture server binds
only to loopback. Unknown API requests fail the run. Chromium blocks requests
outside the fixture origin. Each sample gets a new browser profile and server.

Requires Bun and a local Chromium executable (`CHROMIUM=/path/to/chromium`).
This runner uses Chromium's debugging protocol, with no added browser package.
It uses `--no-sandbox` for container execution: run only trusted local builds.

## Compare two builds

Build the baseline **before** changing application code, and keep its output:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run --cwd apps/web build
cp -a apps/web/dist /tmp/nakama-baseline-dist
# Apply the candidate change, then build it with the same toolchain and lockfile.
bun run --cwd apps/web build
bun run --cwd apps/web perf /tmp/nakama-baseline-dist /absolute/path/to/nakama/apps/web/dist /tmp/web-perf.json
```

For an existing change, build the baseline revision in a separate git worktree.
Do not compare `vite dev` with `vite build`. Stop other builds/tests before
measuring. Keep Chromium, hardware, viewport, and fixture constants identical.
The default is three rounds, in baseline/candidate, candidate/baseline,
baseline/candidate order. `PERF_ROUNDS=1` is a smoke check, not evidence of a win.
The JSON contains raw samples, per-build content hashes, machine/tool versions,
and medians across rounds. Runtime hashes cover `index.html`, `sw.js`, and
`assets/**`; they exclude the generated extension ZIP with build timestamps.
Keep the source revisions with the results.

## Workloads

Each chat has 300 turns / 1,200 source messages. Every turn includes Markdown,
a code fence, a table, and a completed `read_file` call. Both histories and their
syntax highlighting are warmed before measurement. The app still uses its real
virtualized message list, composer, router, query cache, and SSE client.

- **cross-chat:** send in A, switch to B after three chunks, then release the
  remaining 117 chunks at 30 ms intervals. Assert B remains visible and does not
  show A's reply. Assert the stream completes without cancellation.
- **typing:** stream in A while inserting 42 characters, one input every 30 ms.
  Assert all input/frame samples, the exact draft, and the final reply exist.
- **switch:** switch B/A six times using the app's real history links. Wait for
  the destination's rendered report and two animation frames each time.

A gate after the first three chunks keeps navigation and warmup out of the
stream measurement. The fixture content and cadence are fixed; OS scheduling,
React batching, GC, and frame scheduling remain variable. Raw samples include
actual chunk counts. Streams do not use wall time as a success condition.

## What the numbers mean

- `scriptMs`, `taskMs`, `layoutMs`: Chromium `Performance.getMetrics` duration
  deltas over the workload window. Task time includes script/layout and must not
  be added to them. These are renderer timings, not process-wide CPU utilization.
- `inputFrameMs`: input listener to the second `requestAnimationFrame`; summary
  reports the median of each run's p95. This is a frame-readiness proxy, **not
  INP**, and excludes delay before the input event handler starts.
- `switchFrameMs`: in-page link click to destination content plus two animation
  frames. Summary reports the median of each run's six-switch median. It does
  not include all offscreen virtualized rows or guarantee final pixel paint.
- `longTasksMs`: observed main-thread tasks over 50 ms. Heap start/end values
  are raw used JS heap, with uncontrolled GC; they do not prove retained memory
  growth or a leak. `wallMs` includes fixture waits and runner round trips.

No thresholds are enforced on shared CI machines. Compare distributions and
rerun close results. An A/A comparison checks the harness noise floor; it is not
a performance improvement.

## Separate render diagnostics

```sh
PERF_ROUNDS=1 bun run --cwd apps/web perf /tmp/nakama-baseline-dist /absolute/path/to/nakama/apps/web/dist /tmp/web-commits.json --diagnostics
```

This separate pass installs a minimal React DevTools commit hook before the app
loads and records root commits. It does not count component renders or explain
why a component rendered, and it emits no timing claims. Production timing runs
have no React hook. A zero count fails the diagnostic pass as unsupported; it is not proof of zero
rendering.

## Background

Inspired by Julius's [targeted render investigation](https://github.com/pingdotgg/t3code/pull/20380)
and [production, seeded, alternating comparisons](https://github.com/pingdotgg/t3code/pull/21123).
This is a Nakama-specific harness, not a reproduction of an unverified full
T3 CPU/heap harness. [Compiler coverage](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/reactCompilerCoverage.test.ts)
is a compile diagnostic, not a runtime benchmark.

## Initial A/A evidence — 2026-10-18

Baseline: main `b47fad9bfea87f5bcd501805e254b1ece2d6d06d` (v0.4.51).
Candidate: this harness-only change; no application runtime changes. Both builds
used Bun 1.4.3, TypeScript 5.9.3, and Vite 8.3.4. The 529 runtime files have the
same SHA-256: `3bad205864fca143825285a1809b4a4582481ea446a56caeef091bfeb1fdeb1f`.

Linux x64, Intel Xeon Platinum 8573C, Chromium 154.0.8037.57, 1440×1000,
no CPU throttle. No build/test jobs ran during the production samples. This is
shared container hardware, not a dedicated performance machine.

Three alternating rounds, 18 fresh-browser samples. All 12 stream samples
completed 120 chunks, with exactly 117 in each measured window; all six typing
samples preserved all 42 characters. Every switch sample completed six switches.
Raw observations and summary: [results.generated.json](./results.generated.json).

| Metric (ms; median across three runs) | Baseline | Candidate |
| --- | ---: | ---: |
| Cross-chat renderer task time | 383.6 | 323.7 |
| Typing + stream renderer task time | 3531.8 | 3117.7 |
| Typing input-to-two-frames p95 | 56.9 | 56.0 |
| Six switches renderer task time | 1927.7 | 1910.2 |
| Per-switch click-to-content + two frames | 270.4 | 318.3 |

These are **A/A results, not a speedup**. Identical runtime code still varies
between runs. No bottleneck fix, memoization removal, or compiler change is
included. Use the raw distributions before interpreting future comparisons.
The separate [commit diagnostic pass](./commits.generated.json) is not used in
these timings.

Validation: 941 web tests passed (including two fixture tests); web production
build/type check, `bun run check`, and `bun run knip` passed. The first full
`LLM_VCR_MODE=replay bun run test` run had 4,306 passes, 22 skips, and 40 failures:
the sandbox blocked the default config directory, and container PID 1 did not
reap exited subprocesses. All nine failing files were rerun with
`NAKAMA_CONFIG_DIR=/tmp/nakama-perf-test-config` and a temporary Linux
`PR_SET_CHILD_SUBREAPER` wrapper: 154 passed, zero failed. That environment
workaround is not part of the PR; the initial full-suite invocation was not green.
