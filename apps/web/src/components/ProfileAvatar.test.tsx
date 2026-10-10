import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";
import { queryKeys } from "@/lib/query-keys";
import { ProfileAvatar } from "./ProfileAvatar";
import { ProfileRail } from "./ProfileRail";

const profile = {
  createdAt: "2026-10-10T00:00:00Z",
  hasAvatar: false,
  id: "agent-a",
  isSuper: false,
  name: "Agent A",
  updatedAt: "2026-10-09T00:00:00Z",
};

let container: HTMLDivElement;

let root: Root;

let reducedMotion = false;

let media: MediaQueryList;

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  reducedMotion = false;
  originalMatchMedia = window.matchMedia;
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  Object.defineProperty(media, "matches", { get: () => reducedMotion });
  window.matchMedia = () => media;
});

afterEach(async () => {
  await act(async () => root.unmount());
  window.matchMedia = originalMatchMedia;
});

async function renderAvatar(
  props: ComponentProps<typeof ProfileAvatar> = { profile }
) {
  await act(async () => root.render(<ProfileAvatar {...props} />));
  const image = container.querySelector("img");
  expect(image).not.toBeNull();

  return image!;
}

function readSvg(image: HTMLImageElement) {
  const src = image.getAttribute("src")!;
  expect(src.startsWith("data:image/svg+xml,")).toBe(true);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = decodeURIComponent(src.slice(src.indexOf(",") + 1));

  return wrapper.querySelector("svg")!;
}

test("server rendering produces a still SVG without waiting for effects", () => {
  container.innerHTML = renderToStaticMarkup(
    <ProfileAvatar active profile={profile} />
  );
  const image = container.querySelector("img");
  expect(image).not.toBeNull();
  const svg = readSvg(image!);
  expect(svg.querySelector("clipPath path")).not.toBeNull();
  expect(svg.querySelector("animate")).toBeNull();
});

test("uses a stable Moodstone cut and palette across sizes and profile edits", async () => {
  const first = readSvg(await renderAvatar());
  expect(first.querySelector("clipPath path")).not.toBeNull();
  expect(first.querySelectorAll("animate, animateTransform").length).toBe(0);

  const again = readSvg(
    await renderAvatar({
      profile: {
        ...profile,
        name: "Renamed",
        updatedAt: "2026-10-10T00:00:00Z",
      },
      size: "lg",
    })
  );

  expect(again.outerHTML).toBe(first.outerHTML);
});

test("profile IDs select different generated avatars", async () => {
  const first = (await renderAvatar()).getAttribute("src");

  const second = (
    await renderAvatar({ profile: { ...profile, id: "agent-b" } })
  ).getAttribute("src");

  expect(second).not.toBe(first);
});

test("only the active avatar contains SVG animation, with the same cut and color", async () => {
  const still = readSvg(await renderAvatar());
  const animated = readSvg(await renderAvatar({ active: true, profile }));
  expect(
    animated.querySelectorAll("animate, animateTransform").length
  ).toBeGreaterThan(0);
  expect(animated.querySelector("clipPath path")!.getAttribute("d")).toBe(
    still.querySelector("clipPath path")!.getAttribute("d")
  );
  expect(animated.querySelector("stop")!.getAttribute("stop-color")).toBe(
    still.querySelector("stop")!.getAttribute("stop-color")
  );
  const deselected = readSvg(await renderAvatar());
  expect(deselected.querySelectorAll("animate, animateTransform").length).toBe(
    0
  );
});

test("reduced motion starts with a still SVG even for the active agent", async () => {
  reducedMotion = true;
  const svg = readSvg(await renderAvatar({ active: true, profile }));
  expect(svg.querySelectorAll("animate, animateTransform").length).toBe(0);
});

test("changing reduced motion switches between animated and still SVG", async () => {
  const image = await renderAvatar({ active: true, profile });
  expect(readSvg(image).querySelector("animate")).not.toBeNull();
  await act(async () => {
    reducedMotion = true;
    media.dispatchEvent(new window.Event("change"));
  });
  expect(readSvg(image).querySelector("animate")).toBeNull();
  await act(async () => {
    reducedMotion = false;
    media.dispatchEvent(new window.Event("change"));
  });
  expect(readSvg(image).querySelector("animate")).not.toBeNull();
});

test("profiles created before Moodstone keep their Hashvatar", () => {
  for (const old of [
    { ...profile, createdAt: "2026-01-01T00:00:00Z" },
    { ...profile, createdAt: undefined, updatedAt: "2026-01-01T00:00:00Z" },
  ]) {
    container.innerHTML = renderToStaticMarkup(<ProfileAvatar profile={old} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();
  }
});

test("uploaded avatars retain their organization and revision URL", async () => {
  const image = await renderAvatar({
    active: true,
    orgId: "org-a",
    profile: { ...profile, hasAvatar: true },
  });

  const url = new URL(image.getAttribute("src")!, "http://localhost");
  expect(url.pathname).toBe("/v1/profiles/agent-a/avatar");
  expect(url.searchParams.get("orgId")).toBe("org-a");
  expect(url.searchParams.get("v")).toBe(profile.updatedAt);
});

test("Super Bot keeps its default image and uploaded images take precedence", async () => {
  const image = await renderAvatar({
    active: true,
    profile: { ...profile, isSuper: true },
  });

  expect(image.getAttribute("src")).toBe("/super-agent.png");

  const uploaded = await renderAvatar({
    profile: { ...profile, hasAvatar: true, isSuper: true },
  });

  expect(uploaded.getAttribute("src")).toStartWith(
    "/v1/profiles/agent-a/avatar?"
  );
});

test("removing an uploaded avatar restores the same generated avatar", async () => {
  const fallback = (await renderAvatar()).getAttribute("src");
  await renderAvatar({ profile: { ...profile, hasAvatar: true } });
  const restored = await renderAvatar();
  expect(restored.getAttribute("src")).toBe(fallback);
});

test("failed images fall back and a newer upload can be displayed", async () => {
  const image = await renderAvatar({
    profile: { ...profile, hasAvatar: true },
  });

  await act(async () => image.dispatchEvent(new window.Event("error")));
  expect(readSvg(image).querySelector("clipPath path")).not.toBeNull();

  const updated = await renderAvatar({
    profile: { ...profile, hasAvatar: true, updatedAt: "2026-10-10T00:00:00Z" },
  });

  expect(updated.getAttribute("src")).toStartWith(
    "/v1/profiles/agent-a/avatar?"
  );
});

test.each([
  ["/chat", true],
  ["/chat/agent-a/session-a", true],
  ["/profiles", false],
  ["/automations", false],
] as const)("rail uses chat-only motion on %s", async (pathname, animated) => {
  const previousState = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ orgId: null, profileId: profile.id });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queryClient.setQueryData(queryKeys.profiles.all, [
    profile,
    { ...profile, id: "agent-b", name: "Agent B" },
  ]);

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[pathname]}>
          <QueryClientProvider client={queryClient}>
            <AuthContext.Provider
              value={
                /* SAFETY: The signed-out rail reads only these auth fields; no account actions are available. */
                {
                  activeOrg: null,
                  isAuthenticated: false,
                  isLoading: false,
                  user: null,
                } as AuthContextValue
              }
            >
              <AppContext.Provider
                value={
                  /* SAFETY: The signed-out account menu reads only health before returning null. */
                  { health: null } as AppContextValue
                }
              >
                <ThemeContext.Provider
                  value={{
                    resolvedTheme: "light",
                    setTheme: () => {},
                    theme: "light",
                    toggleTheme: () => {},
                  }}
                >
                  <ProfileRail />
                </ThemeContext.Provider>
              </AppContext.Provider>
            </AuthContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );

    const activeImage = container.querySelector<HTMLImageElement>(
      'button[aria-label="Agent A"] img'
    )!;

    const inactiveImage = container.querySelector<HTMLImageElement>(
      'button[aria-label="Agent B"] img'
    )!;

    expect(readSvg(activeImage).querySelector("animate") !== null).toBe(
      animated
    );
    expect(readSvg(inactiveImage).querySelector("animate")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    useActiveChatProfileStore.setState(previousState);
    queryClient.clear();
  }
});
