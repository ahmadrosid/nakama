import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { ProjectPage } from "./FilesPage";

test("switching projects keeps exactly one composer and resets the content tab", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const workspaces = ["alpha", "beta", "gamma"].map((id) => ({
    id,
    kind: "project",
    name: id,
  }));
  queryClient.setQueryData(["chatWorkspaces", "org-test"], { workspaces });
  for (const { id } of workspaces) {
    queryClient.setQueryData(["chatWorkspaces", "org-test", id, "files"], {
      files: [
        {
          filename: "notes.txt",
          id: "file-1",
          mediaType: "text/plain",
          path: "notes.txt",
          sizeBytes: 12,
        },
        {
          filename: "movie.mp4",
          id: "video-1",
          mediaType: "application/octet-stream",
          path: "movie.mp4",
          sizeBytes: 20 * 1024 * 1024,
        },
      ],
    });
    queryClient.setQueryData(["chatWorkspaces", "org-test", id, "pins"], {
      fileIds: [],
    });
    queryClient.setQueryData(["sessions", "org-test", id], { sessions: [] });
  }
  queryClient.setQueryData(queryKeys.profiles.all, [
    { id: "agent", model: null, name: "Agent" },
  ]);
  queryClient.setQueryData(queryKeys.profiles.detail("agent"), { skills: [] });
  queryClient.setQueryData(queryKeys.health, { providerConfigured: true });
  queryClient.setQueryData(queryKeys.models, { models: [] });
  queryClient.setQueryData(queryKeys.thinkingSettings, {
    effort: "medium",
    enabled: true,
  });
  const auth = {
    activeOrg: { id: "org-test", role: "admin" },
    user: null,
  } as AuthContextValue;
  let navigate!: ReturnType<typeof useNavigate>;
  function Navigation() {
    navigate = useNavigate();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const readFile = spyOn(client, "readChatWorkspaceFile").mockResolvedValue(
    new Blob(["Project source preview"], { type: "text/plain" })
  );
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={["/projects/alpha"]}>
              <Navigation />
              <Routes>
                <Route
                  element={<ProjectPage />}
                  path="/projects/:workspaceId"
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
    });
    for (const id of ["beta", "gamma", "alpha"]) {
      const sources = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      ).find((tab) => tab.textContent === "Sources")!;
      await act(async () => {
        sources.click();
      });
      await act(async () => {
        navigate(`/projects/${id}`);
      });
      expect(container.querySelectorAll("textarea")).toHaveLength(1);
      expect(container.querySelector("h1")?.textContent).toBe(id);
      expect(
        container.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent
      ).toBe("Chats");
    }
    const sources = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ).find((tab) => tab.textContent === "Sources")!;
    await act(async () => {
      sources.click();
    });
    const file = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent?.includes("notes.txt"))!;
    expect(file).toBeDefined();
    await act(async () => {
      file.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(readFile).toHaveBeenCalledWith("alpha", "notes.txt", {
      render: undefined,
    });
    expect(container.textContent).toContain("Project source preview");
    const movie = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent?.includes("movie.mp4"))!;
    await act(async () => {
      movie.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
    expect(video?.getAttribute("src")).toContain(
      "/v1/workspaces/alpha/files/content?path=movie.mp4&inline=1"
    );
    expect(readFile).toHaveBeenCalledTimes(1);
  } finally {
    readFile.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});
