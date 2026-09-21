import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeContext } from "@/context/theme-context-shared";
import { transformChatUrl } from "@/lib/transform-chat-url";
import { MessageResponse } from "./message";

test("Markdown images use the proxy, but links and local attachments do not", () => {
  const remote = "https://images.example.com/photo.png?x=1&y=two";
  const html = renderToStaticMarkup(
    <ThemeContext.Provider
      value={{
        resolvedTheme: "light",
        setTheme: () => {},
        theme: "light",
        toggleTheme: () => {},
      }}
    >
      <MessageResponse linkSafety={{ enabled: false }} mode="static">
        {`![Remote](${remote})\n\n![Upload](/v1/attachments/abc/content)\n\n[Source](${remote})`}
      </MessageResponse>
    </ThemeContext.Provider>
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(
    container.querySelector('img[alt="Remote"]')?.getAttribute("src")
  ).toBe(`/v1/chat/images/proxy?url=${encodeURIComponent(remote)}`);
  expect(
    container.querySelector('img[alt="Upload"]')?.getAttribute("src")
  ).toBe("/v1/attachments/abc/content");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(remote);
});

test("protocol-relative images are proxied and unsafe schemes remain blocked", () => {
  const node = {
    children: [],
    properties: {},
    tagName: "img",
    type: "element" as const,
  };
  const rewritten = transformChatUrl(
    "//images.example.com/photo.png",
    "src",
    node
  );
  expect(rewritten).toBe(
    `/v1/chat/images/proxy?url=${encodeURIComponent(new URL("//images.example.com/photo.png", window.location.origin).href)}`
  );
  expect(transformChatUrl("javascript:alert(1)", "src", node)).toBe("");
  expect(
    transformChatUrl(
      `${window.location.origin}/v1/attachments/abc/content`,
      "src",
      node
    )
  ).toBe(`${window.location.origin}/v1/attachments/abc/content`);
});
