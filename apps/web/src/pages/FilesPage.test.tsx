import { expect, spyOn, test } from "bun:test";
import type { WorkspaceEntry } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { FilesPage } from "./FilesPage";

test("rename menu submits the full name, retains failures, and refreshes file listings", async () => {
  const { FilesRename } = await import("./files/files-delete-dialog");
  const { FileEntry } = await import("./files/files-artifact-list-view");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rename = spyOn(
    client,
    "renameProfileWorkspaceEntry"
  ).mockRejectedValueOnce(new Error("Name exists"));
  const invalidation = spyOn(queryClient, "invalidateQueries");
  const renamed: string[][] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <FilesRename
            onRenamed={(before, after) => renamed.push([before, after])}
            profileId="rename-profile"
          >
            <ul>
              <FileEntry
                filename="report.md"
                onOpen={() => {}}
                pinPath="notes/report.md"
                viewMode="grid"
              />
            </ul>
          </FilesRename>
        </QueryClientProvider>
      )
    );
    await act(async () =>
      (
        container.querySelector(
          '[aria-label="Actions for report.md"]'
        ) as HTMLButtonElement
      ).click()
    );
    await act(async () =>
      (document.querySelector('[role="menuitem"]') as HTMLElement).click()
    );
    const input = document.querySelector(
      'input[aria-label="Name"]'
    ) as HTMLInputElement;
    expect(input.value).toBe("report.md");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "summary.md");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const submit = async () => {
      await act(async () => {
        document
          .querySelector("form")!
          .dispatchEvent(
            new window.Event("submit", { bubbles: true, cancelable: true })
          );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    await submit();
    expect(rename).toHaveBeenCalledWith("rename-profile", {
      newName: "summary.md",
      path: "notes/report.md",
    });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(input.value).toBe("summary.md");
    expect(renamed).toEqual([]);
    rename.mockResolvedValueOnce({
      filename: "notes/summary.md",
      kind: "file",
      mimeType: "text/markdown",
      path: "notes/summary.md",
      sizeBytes: 1,
      updatedAt: "",
    });
    await submit();
    expect(renamed).toEqual([["notes/report.md", "notes/summary.md"]]);
    expect(invalidation).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    rename.mockRestore();
    invalidation.mockRestore();
  }
});

test("Files starts at the workspace root and opens nested files read-only", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "",
      id: "org-files",
      name: "Files",
      role: "admin",
      slug: "files",
      updatedAt: "",
    },
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: async () => {},
    orgs: [],
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async () => {},
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
  const folder: WorkspaceEntry = {
    filename: "notes",
    kind: "directory",
    mimeType: "application/octet-stream",
    path: "notes",
    sizeBytes: 0,
    updatedAt: "2026-09-20T00:00:00Z",
  };
  const file: WorkspaceEntry = {
    ...folder,
    filename: "notes/daily.md",
    kind: "file",
    mimeType: "text/markdown",
    path: "notes/daily.md",
    sizeBytes: 12,
  };
  queryClient.setQueryData(queryKeys.profiles.all, [{ id: "profile-files" }]);
  queryClient.setQueryData(
    ["workspace-files", "org-files", "profile-files", ""],
    { entries: [folder] }
  );
  queryClient.setQueryData(
    ["workspace-files", "org-files", "profile-files", "notes"],
    { entries: [file] }
  );
  queryClient.setQueryData(
    [
      "workspace-preview",
      "org-files",
      "profile-files",
      file.path,
      file.updatedAt,
    ],
    { blob: new Blob(["Daily notes"]), text: "Daily notes" }
  );
  const pinsKey = ["file-pins", "org-files", "admin", "profile-files"];
  queryClient.setQueryData(pinsKey, { entries: [] });
  let pinned: WorkspaceEntry | null = null;
  const pinRequest = spyOn(client, "setProfileFilePinned").mockImplementation(
    async (_profileId, body) => {
      pinned = body.pinned ? (body.path === folder.path ? folder : file) : null;
    }
  );
  const listPins = spyOn(client, "listProfileFilePins").mockImplementation(
    async () => ({ entries: pinned ? [pinned] : [] })
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ThemeContext.Provider
              value={{
                resolvedTheme: "light",
                setTheme: () => {},
                theme: "light",
                toggleTheme: () => {},
              }}
            >
              <MemoryRouter>
                <FilesPage />
              </MemoryRouter>
            </ThemeContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "All files"
    );
    const folderButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.startsWith("notes")
    );
    expect(folderButton).toBeDefined();
    await act(async () => {
      (
        container.querySelector('[aria-label="Pin notes"]') as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(pinRequest).toHaveBeenCalledWith("profile-files", {
      path: "notes",
      pinned: true,
    });
    const pinnedFolder = container.querySelector(
      '[aria-label="Pinned files"] button[title="notes"]'
    ) as HTMLButtonElement;
    expect(pinnedFolder).not.toBeNull();
    await act(async () => pinnedFolder.click());
    expect(
      container.querySelector('[data-slot="attachment-detail-panel"]')
    ).toBeNull();
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Unpin notes"]'
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(
      container.querySelector('nav[aria-label="Folder"]')?.textContent
    ).toContain("notes");
    await act(async () => {
      (
        container.querySelector('[aria-label="List view"]') as HTMLButtonElement
      ).click();
    });
    expect(
      [...container.querySelectorAll("th")].map((cell) => cell.textContent)
    ).toEqual(["Name", "Type", "Size", "Modified", "Actions"]);
    expect(container.querySelector("tbody")?.textContent).toContain("daily.md");
    expect(container.querySelector("tbody")?.textContent).toContain("12 B");
    const fileButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.startsWith("daily.md")
    );
    expect(fileButton).toBeDefined();
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Pin daily.md"]'
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(pinRequest).toHaveBeenCalledWith("profile-files", {
      path: "notes/daily.md",
      pinned: true,
    });
    expect(
      container.querySelector('[aria-label="Pinned files"]')?.textContent
    ).toContain("notes/daily.md");
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Unpin notes/daily.md"]'
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(pinRequest).toHaveBeenLastCalledWith("profile-files", {
      path: "notes/daily.md",
      pinned: false,
    });
    expect(container.querySelector('[aria-label="Pinned files"]')).toBeNull();
    pinRequest.mockRejectedValueOnce(new Error("Unable to save pin"));
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Pin daily.md"]'
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Pinned files"]')).toBeNull();

    await act(async () => fileButton!.click());
    const panel = () =>
      container.querySelector('[data-slot="attachment-detail-panel"]');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(panel()?.textContent).toContain("Daily notes");
    expect(
      panel()!.querySelector('[aria-label="Resize panel"]')
    ).not.toBeNull();
    await act(async () =>
      (
        panel()!.querySelector(
          '[aria-label="Enter fullscreen"]'
        ) as HTMLButtonElement
      ).click()
    );
    expect(
      panel()!.querySelector('[aria-label="Exit fullscreen"]')
    ).not.toBeNull();
    expect(panel()!.querySelector('[aria-label="Resize panel"]')).toBeNull();
    await act(async () =>
      (
        panel()!.querySelector('[aria-label="Code"]') as HTMLButtonElement
      ).click()
    );
    expect(
      panel()
        ?.querySelector('[aria-label="Code"]')
        ?.getAttribute("aria-pressed")
    ).toBe("true");
    await act(async () =>
      (
        panel()!.querySelector(
          '[aria-label="More artifact actions"]'
        ) as HTMLButtonElement
      ).click()
    );
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "Download"
    );
    expect(document.querySelector('[role="menu"]')?.textContent).not.toMatch(
      /Delete|Edit/
    );
    await act(async () =>
      (
        panel()!.querySelector(
          '[aria-label="Close attachment panel"]'
        ) as HTMLButtonElement
      ).click()
    );
    expect(panel()).toBeNull();
    await act(async () => fileButton!.click());
    expect(panel()?.textContent).toContain("Daily notes");
    expect(
      panel()!.querySelector('[aria-label="Enter fullscreen"]')
    ).not.toBeNull();
    const unsupported = {
      ...file,
      filename: "notes/captions & notes.vtt",
      mimeType: "application/octet-stream",
      path: "notes/captions & notes.vtt",
    };
    await act(async () =>
      (
        panel()!.querySelector(
          '[aria-label="Close attachment panel"]'
        ) as HTMLButtonElement
      ).click()
    );
    await act(async () => {
      queryClient.setQueryData(
        ["workspace-files", "org-files", "profile-files", "notes"],
        { entries: [file, unsupported] }
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const unsupportedButton = container.querySelector(
      'button[title="captions & notes.vtt"]'
    ) as HTMLButtonElement;
    expect(unsupportedButton).not.toBeNull();
    await act(async () => unsupportedButton.click());
    const download = panel()!.querySelector("a[download]") as HTMLAnchorElement;
    expect(download).not.toBeNull();
    expect(download.download).toBe("captions & notes.vtt");
    const url = new URL(download.href);
    expect(url.pathname).toBe("/v1/profiles/profile-files/workspace/content");
    expect(url.searchParams.get("path")).toBe(unsupported.path);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    pinRequest.mockRestore();
    listPins.mockRestore();
  }
});

test("artifact pagination counts visible entries and stops at the last entry", async () => {
  const { FilesArtifactViews } = await import("./files/files-artifact-views");
  const { listArtifactsInFolder } = await import(
    "./files/files-artifact-folders"
  );
  const artifacts = Array.from({ length: 100 }, (_, index) => ({
    filename: `notes/${index}.txt`,
    mimeType: "text/plain",
    path: `notes/${index}.txt`,
    sizeBytes: 1,
    updatedAt: "2026-09-20T00:00:00Z",
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (files: typeof artifacts) => {
    const listing = listArtifactsInFolder(files, "");
    await act(async () =>
      root.render(
        <FilesArtifactViews
          artifacts={files}
          deletePending={false}
          emptyFilterMessage=""
          error={null}
          folders={listing.folders}
          isLoading={false}
          listingFiles={listing.files}
          onDelete={() => {}}
          onOpenFolder={() => {}}
          profileId="profile-files"
          showFullPath={false}
          viewMode="grid"
        />
      )
    );
  };
  const showMore = () =>
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Show more")
    );
  try {
    await render(artifacts);
    expect(container.querySelectorAll("li").length).toBe(1);
    expect(showMore()).toBeUndefined();
    await render(
      artifacts.slice(0, 31).map((file, index) => ({
        ...file,
        filename: `folder-${index}/note.txt`,
      }))
    );
    expect(container.querySelectorAll("li").length).toBe(30);
    expect(showMore()).toBeDefined();
    await act(async () => showMore()!.click());
    expect(container.querySelectorAll("li").length).toBe(31);
    expect(showMore()).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a Word preview renders as markdown, not as a plain code listing", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "",
      id: "org-docx",
      name: "Docx",
      role: "admin",
      slug: "docx",
      updatedAt: "",
    },
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: async () => {},
    orgs: [],
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async () => {},
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
  const report: WorkspaceEntry = {
    filename: "report.docx",
    kind: "file",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    path: "report.docx",
    sizeBytes: 2048,
    updatedAt: "2026-09-20T00:00:00Z",
  };
  queryClient.setQueryData(queryKeys.profiles.all, [{ id: "profile-docx" }]);
  queryClient.setQueryData(
    ["workspace-files", "org-docx", "profile-docx", ""],
    { entries: [report] }
  );
  // The server converts a Word file, so the preview query holds Markdown even
  // though the entry's mime type is still the .docx one.
  queryClient.setQueryData(
    [
      "workspace-preview",
      "org-docx",
      "profile-docx",
      report.path,
      report.updatedAt,
    ],
    { blob: new Blob(["## Findings"]), text: "## Findings" }
  );
  queryClient.setQueryData(["file-pins", "org-docx", "admin", "profile-docx"], {
    entries: [],
  });
  spyOn(client, "listProfileFilePins").mockImplementation(async () => ({
    entries: [],
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ThemeContext.Provider
              value={{
                resolvedTheme: "light",
                setTheme: () => {},
                theme: "light",
                toggleTheme: () => {},
              }}
            >
              <MemoryRouter>
                <FilesPage />
              </MemoryRouter>
            </ThemeContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    const fileButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.startsWith("report.docx")
    ) as HTMLButtonElement;
    expect(fileButton).toBeDefined();
    await act(async () => {
      fileButton.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const panel = container.querySelector(
      '[data-slot="attachment-detail-panel"]'
    );
    expect(panel).not.toBeNull();
    // The panel's own title is an h2, so look for the heading the Markdown
    // produced rather than the first one in the subtree.
    const headings = [...(panel?.querySelectorAll("h2") ?? [])].map(
      (node) => node.textContent
    );
    expect(headings).toContain("Findings");
    expect(panel?.textContent).not.toContain("## Findings");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
