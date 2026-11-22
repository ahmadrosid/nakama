# Test failure log

Every test failure we fix gets one row, from 2026-11-21 to 2026-12-05. After that, the rows decide which tests go:

- **regression**: the test caught a real bug in the product. Keep it.
- **change detector**: the test failed only because the code changed on purpose (copy, a mock's call order, a snapshot of internals). Delete the file once its rows show nothing else, and add its pattern to the list in AGENTS.md.
- **test bug**: the test itself was wrong (order leak, shared state, wall clock). Fix it; it says nothing about the product.

Never delete tests for authorization, privacy, migrations or concurrency, whatever their rows say.

| Date | Test file | What failed | Class | Fix |
| --- | --- | --- | --- | --- |
| 2026-11-21 | `apps/server/src/http/routes/system-version.test.ts` | Random order: a test with a later clock left a cached release the route then served | regression | A cache entry stamped after `now` is stale (a clock that moves back had the same bug) |
| 2026-11-21 | `apps/server/src/services/mcp-oauth.test.ts` | Random order: asserted the shared fake server saw 0 token requests | test bug | Count from a baseline, like the other tests in the file |
| 2026-11-21 | `packages/core/src/anydoc-text.test.ts` | Random order: a cut-off conversion still held a slot when the next test started | test bug | The test waits for its conversion to stop |
| 2026-11-21 | `apps/server/src/http/routes/llm.test.ts` | Random order: the vendor request log was never cleared | test bug | Clear it after each test |
| 2026-11-21 | `apps/server/src/services/javascript-tool-loader.test.ts` | Random order: the resolver tests used a secret store another block set up | test bug | Own setup per block |
| 2026-11-21 | `apps/server/src/tools/super-nakama-tool-setup.test.ts` | Random order: a key one case saved reached the next case | test bug | Fresh secret store per test |
| 2026-11-21 | `apps/server/src/services/data-portability.test.ts` | "backup restore preserves current publication authority" timed out at 5 s once in CI shard 7 (run 44879345127); 0.09 s alone, 0.2–0.8 s under load | open | Suspect the plugin export barrier: it polls up to 6 s for `activeMutations` to reach 0, so a mutation another test left open would stall it |
| 2026-11-22 | `apps/server/src/services/skills-service.test.ts` | "shared Python tool.py keeps review and team execution checks" timed out at 5 s in Windows shard 1 (run 44932129339) | test bug | The first Python start on a fresh runner took 730 ms (the next took 84 ms). CI now starts Python once before the tests |
| 2026-11-22 | `apps/server/src/services/python-tool-loader.test.ts` | Windows timeouts: loading `tool-resolver` inside the test took 1,024 ms of its 5 s | test bug | Six test files import at the top instead (#2658) |
| 2026-11-22 | 7 Windows test files | 5–11 s on Windows, about 1 s on Linux: SQLite and temp files under `TEMP` on `C:`, which syncs about 14x slower than `D:` | test bug | CI puts `TEMP` on `D:` (#2643) |
