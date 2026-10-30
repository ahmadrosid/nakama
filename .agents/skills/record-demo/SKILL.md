---
name: record-demo
description: >-
  Record an MP4 product demo of a Nakama flow in BrowserOS (browseros-neo MCP)
  on the user's dev app at http://localhost:3003. Use when the user says
  /record-demo, "make a demo video", "record a demo of X", or asks for an mp4
  that shows a feature working end to end (for example connecting an MCP
  server from chat and using it).
---

# Record a demo video in BrowserOS

Drive the real app in BrowserOS, capture frames with CDP screenshots, and
join them into an H.264 MP4. BrowserOS has no screen recorder. `ffmpeg`
screen capture hangs when the app has no macOS Screen Recording permission,
so do not use it.

Reference run: Canva MCP demo. Chat → **+ → MCP servers → Add MCP server** →
**Connect Canva** → Canva consent → ask for a poster → poster in chat → open
in Canva.

## Rules

1. Use the user's app on `http://localhost:3003` and their BrowserOS sign-ins.
   Do not start another server. If 3003 gives 502, start the API with
   `NAKAMA_PORT=4310 bun run dev:server`.
2. Never type a password. If a sign-in page needs one, stop and ask the user
   to sign in in BrowserOS. A consent click ("Allow") is OK only when the user
   asked you to do the sign-in.
3. Keep frames, plans and videos in the scratchpad. Never commit them.
4. Before you report done, look at the frames. Do not claim what you did not see.
5. Tell the user what the demo changed in their data (new MCP server, new
   chats, files in third-party accounts).

## Steps

### 1. Agree the story

Get from the user: the start screen, each step, and the end screen. Write it
as 4–8 short shots. If it is not clear, give 3 numbered options.

### 2. Check the start state

1. Check that the start state is clean. Example: a "connect" demo needs the
   server not to exist yet (MCP server names are unique). Ask before you
   delete user data to make it clean.
2. Do a dry run of the menus with `snapshot` (mode `interactive`) to learn the
   button names. Close dialogs after (`Escape`) so the take starts clean.

### 3. Start the frame server and the relay tab

```bash
REC=<scratchpad>/record-demo
mkdir -p "$REC"
nohup bun .agents/skills/record-demo/scripts/frame-server.mjs "$REC/frames" 4399 > "$REC/frame-server.log" 2>&1 &
curl -s http://127.0.0.1:4399/
```

Then, in BrowserOS:

1. `name_session` with a short task label.
2. `run`: `const relay = await browser.open("http://127.0.0.1:4399/"); return relay.id;`
   The relay tab posts frames to the server from the same origin, so CORS
   and mixed-content rules do not block it.
3. `run`: `const p = await browser.open("http://localhost:3003/chat?new=1"); return p.id;`

### 4. Record in parts

A `run` call stops at 30 s. Record each part in its own `run`, with at most
25 s of capture. Paste this snippet at the top of each `run`, and set
`RELAY_ID` and `TARGET_ID`:

```js
const RELAY = browser.page(RELAY_ID);
const REC = { target: TARGET_ID, on: true, buf: [], n: 0 };
async function flush() {
  if (!REC.buf.length) return;
  const items = REC.buf;
  REC.buf = [];
  await RELAY.evaluate((it) => fetch("/frames", { method: "POST", body: JSON.stringify(it) }).then((r) => r.text()), items);
}
async function recLoop(ms) {
  const end = Date.now() + ms;
  while (REC.on && Date.now() < end) {
    try {
      const shot = await browser.page(REC.target).cdp("Page.captureScreenshot", JSON.stringify({ format: "jpeg", quality: 72 }));
      REC.buf.push({ t: Date.now(), d: shot.data });
      REC.n++;
      if (REC.buf.length >= 8) await flush();
    } catch (e) { console.log("capture error", String(e)); await sleep(100); }
  }
  await flush();
}
const ref = (snap, re) => { const line = snap.text.split("\n").find((l) => re.test(l)); const m = line && line.match(/\[ref=(e\d+)\]/); return m && m[1]; };
// Purple dot cursor: BrowserOS clicks do not move a visible mouse.
async function cursorTo(page, r) {
  const node = await page.resolveRef(r);
  const box = await page.cdp("DOM.getBoxModel", JSON.stringify({ backendNodeId: node.backendNodeId }));
  const q = box.model.content;
  const p = [(q[0] + q[4]) / 2, (q[1] + q[5]) / 2];
  await page.evaluate((p) => {
    let c = document.getElementById("__dc");
    if (!c) {
      c = document.createElement("div");
      c.id = "__dc";
      c.style.cssText = "position:fixed;z-index:2147483647;width:24px;height:24px;border-radius:50%;background:rgba(124,58,237,.3);border:2px solid #7c3aed;pointer-events:none;left:50%;top:50%;transform:translate(-50%,-50%);transition:left .6s ease,top .6s ease";
      document.documentElement.appendChild(c);
    }
    c.style.left = p[0] + "px";
    c.style.top = p[1] + "px";
  }, p);
  await sleep(750);
}
async function clickRe(page, re) {
  const snap = await page.snapshot({ mode: "interactive" });
  const r = ref(snap, re);
  if (!r) throw new Error("no ref for " + re);
  await cursorTo(page, r);
  await page.click(r);
}
async function typeSlow(page, text) {
  for (const word of text.match(/\S+\s*/g)) { await page.type(word); await sleep(60); }
}
```

Body of a part:

```js
const page = browser.page(TARGET_ID);
const rec = recLoop(22000);
const out = {};
try {
  await sleep(800);
  await clickRe(page, /button "Add attachment"/);
  await clickRe(page, /MCP servers/);
  await page.waitForText("Add MCP server");
  // ...the steps of this shot, with short sleeps so a viewer can follow
} catch (e) { out.err = String(e); }
REC.on = false;
await rec;
out.frames = REC.n;
return out;
```

Tips:

1. Put `page.goto` before `recLoop`. A slow load can push the run past 30 s.
2. A sign-in link opens a new tab. Read `browser.pages.list()` before and
   after the click, then set `REC.target` to the new page id. The tab can show
   as the user's tab. You can still capture it.
3. While the agent replies, record more 25 s parts. Stop when the snapshot
   has no `Stop response` button.
4. One frame takes about 40 ms. A part gives about 15 frames per second.

### 5. Check the frames

```bash
bun .agents/skills/record-demo/scripts/build-video.mjs segments "$REC/frames"
```

Each line is one part. Open frames with `Read` at the start, middle and end of
each part. Look for:

1. Images that did not load. A grey or blank box is a fail. To check an image
   in the page, draw it on a canvas and count its colours. A count of 1 is a
   placeholder. Example: a Canva thumbnail fetched while the design is still
   rendering is a flat grey PNG.
2. Raw markdown or URLs that show while a reply streams.
3. Dialogs and toasts that cover the step.

If a part is bad, record a fix part (for example a follow-up prompt), or
leave the part out of the plan.

### 6. Build the MP4

Write `$REC/plan.json`. List the parts in play order. Speed up waits. Trim
the start of a part. Leave out bad parts.

```json
{
  "segments": [
    { "n": 1 }, { "n": 2 }, { "n": 3 },
    { "n": 5, "speed": [[0, 1], [7.5, 2]] },
    { "n": 6, "speed": [[0, 4]] },
    { "n": 10, "trim": 2.9 }
  ],
  "maxFrame": 0.4,
  "hold": 2.5,
  "width": 1920
}
```

`maxFrame` caps one frame's time on screen, which removes the gaps between
parts.

```bash
bun .agents/skills/record-demo/scripts/build-video.mjs build "$REC/frames" "$REC/plan.json" "$REC/demo.mp4"
bun .agents/skills/record-demo/scripts/build-video.mjs sheet "$REC/demo.mp4" "$REC/sheet.jpg" 6
ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of csv=p=0 "$REC/demo.mp4"
```

Pass only if the codec is `h264`, and the contact sheet shows each shot in
order with no bad frames.

### 7. Deliver and clean up

1. Send the MP4 with `SendUserFile` (`display: "render"`). Give its full path.
2. Close the relay tab (`tabs` action `close`). Stop the server:
   `pkill -f record-demo/scripts/frame-server.mjs`.
3. Leave the demo tabs open for the user.
4. Report: the length, the shots, the parts you left out and why, and the data
   the demo changed.
