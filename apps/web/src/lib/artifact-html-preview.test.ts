import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  htmlForArtifactPreview,
  resolveArtifactHtmlAssets,
} from "./artifact-html-preview";

describe("htmlForArtifactPreview", () => {
  test("injects scrollbar styles into head", () => {
    const html = "<html><head><title>Slides</title></head><body></body></html>";
    expect(htmlForArtifactPreview(html)).toContain(
      "<head><style data-nakama-html-preview>"
    );
  });

  test("wraps fragments with style tag", () => {
    expect(htmlForArtifactPreview("<div>slide</div>")).toStartWith(
      "<style data-nakama-html-preview>"
    );
  });
});

// Parse real HTML without loading its subresources in the test process.
const dom = new Window();
const originalParser = globalThis.DOMParser;
beforeEach(() => {
  globalThis.DOMParser = dom.DOMParser as unknown as typeof DOMParser;
});
afterEach(() => {
  globalThis.DOMParser = originalParser;
});

function assetReader(calls: string[]) {
  return async (path: string) => {
    calls.push(path);
    return {
      contentType: path.endsWith(".css") ? "text/css" : "image/png",
      data: new TextEncoder().encode(
        path.endsWith(".css")
          ? 'body { background: url("../bg.png") }'
          : "asset"
      ).buffer,
    };
  };
}

describe("relative HTML artifact assets", () => {
  test("loads sibling and parent media from the HTML artifact directory", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    try {
      const html = await resolveArtifactHtmlAssets(
        '<img src="shot.png"><img src="../wide.png"><video src="../video/clip.mp4" poster="shot.png"><source src="../audio.wav"></video>',
        "project/shots/review.html",
        assetReader(calls),
        controller.signal
      );
      const document = new DOMParser().parseFromString(html, "text/html");
      expect(calls).toEqual([
        "project/shots/shot.png",
        "project/wide.png",
        "project/video/clip.mp4",
        "project/audio.wav",
      ]);
      for (const node of document.querySelectorAll("[src], [poster]")) {
        expect(
          node.getAttribute("src") ?? node.getAttribute("poster")
        ).toStartWith("data:");
      }
    } finally {
      controller.abort();
    }
  });

  test("resolves stylesheet dependencies, inline CSS, and responsive images", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    try {
      const html = await resolveArtifactHtmlAssets(
        '<link rel="stylesheet" href="css/site.css"><style>body{background:url(bg.png)}</style><img style="background:url(bg.png)" srcset="small.png 1x, large.png 2x">',
        "project/review.html",
        assetReader(calls),
        controller.signal
      );
      expect(calls).toEqual([
        "project/css/site.css",
        "project/bg.png",
        "project/small.png",
        "project/large.png",
      ]);
      const document = new DOMParser().parseFromString(html, "text/html");
      const css = await fetch(
        document.querySelector("link")!.getAttribute("href")!
      ).then((r) => r.text());
      expect(css).toContain('url("data:');
      expect(document.querySelector("style")!.textContent).toContain(
        'url("data:'
      );
      expect(document.querySelector("img")!.getAttribute("srcset")).toMatch(
        /data:.* 1x, data:.* 2x/
      );
    } finally {
      controller.abort();
    }
  });

  test("blocks escapes and failed assets without breaking the rest of the document", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    try {
      const html = await resolveArtifactHtmlAssets(
        '<h1>Review</h1><img src="../../secret.png"><img src="%2e%2e/%2e%2e/secret.png"><img src="missing.png"><img src="https://example.com/image.png"><img src="data:image/png;base64,eA==">',
        "project/review.html",
        async (p) => {
          calls.push(p);
          throw new Error("missing");
        },
        controller.signal
      );
      const document = new DOMParser().parseFromString(html, "text/html");
      expect(calls).toEqual(["project/missing.png"]);
      expect(
        [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"))
      ).toEqual([
        "about:blank",
        "about:blank",
        "about:blank",
        "https://example.com/image.png",
        "data:image/png;base64,eA==",
      ]);
      expect(document.querySelector("h1")!.textContent).toBe("Review");
    } finally {
      controller.abort();
    }
  });
});

test("cancelling a pending asset prevents further reads and asset embedding", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const result = resolveArtifactHtmlAssets(
    '<img src="first.png"><img src="second.png">',
    "review.html",
    async (path) => {
      calls.push(path);
      controller.abort();
      return { contentType: "image/png", data: new ArrayBuffer(0) };
    },
    controller.signal
  );
  await expect(result).rejects.toThrow();
  expect(calls).toEqual(["first.png"]);
});

test("CSS import cycles terminate and imported assets keep their own directory", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  try {
    const html = await resolveArtifactHtmlAssets(
      '<link rel="stylesheet" href="styles/a.css">',
      "project/review.html",
      async (path) => {
        calls.push(path);
        return {
          contentType: "text/css",
          data: new TextEncoder().encode(
            path.endsWith("a.css")
              ? '@import "nested/b.css";'
              : '@import "../a.css";'
          ).buffer,
        };
      },
      controller.signal
    );
    expect(calls).toEqual([
      "project/styles/a.css",
      "project/styles/nested/b.css",
    ]);
    expect(html).toContain('href="data:');
  } finally {
    controller.abort();
  }
});

test("encoded filenames retain fragments without treating query strings as filenames", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  try {
    const html = await resolveArtifactHtmlAssets(
      '<video src="../clip%20one.mp4?v=2#t=1"><img srcset="data:image/png;base64,eA== 1x, photo.png 2x"></video>',
      "project/shots/review.html",
      assetReader(calls),
      controller.signal
    );
    expect(calls).toEqual(["project/clip one.mp4", "project/shots/photo.png"]);
    expect(html).toContain("#t=1");
    expect(html).toContain("data:image/png;base64,eA== 1x, data:");
  } finally {
    controller.abort();
  }
});

test("CSS comments and string content are not mistaken for asset requests", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  try {
    const css =
      '/* url(missing.png) */ p::after{content:"url(example.png)"} div{background:url(https://example.com/image.png)}';
    const html = await resolveArtifactHtmlAssets(
      `<style>${css}</style>`,
      "review.html",
      assetReader(calls),
      controller.signal
    );
    expect(calls).toEqual([]);
    expect(html).toContain(css);
  } finally {
    controller.abort();
  }
});

test("relative base directories resolve within the profile artifact root", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  try {
    await resolveArtifactHtmlAssets(
      '<base href="../"><img src="cover.png">',
      "project/review.html",
      assetReader(calls),
      controller.signal
    );
    expect(calls).toEqual(["cover.png"]);
  } finally {
    controller.abort();
  }
});
