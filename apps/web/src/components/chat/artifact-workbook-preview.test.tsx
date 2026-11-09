import { expect, spyOn, test } from "bun:test";
import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import {
  type ChatAttachmentPanelConfig,
  ChatAttachmentPanelContext,
} from "@/context/chat-attachment-panel-context-shared";
import { ThemeProvider } from "@/context/theme-context";
import { FilePreviewCard } from "./artifact-attachment-preview";
import { WorkbookGrid } from "./artifact-workbook-preview";
import { clampAttachmentPanelWidth } from "./attachment-panel-width";
import { DocumentAttachmentPreview } from "./document-attachment-preview";

const workbook = {
  sheets: [
    {
      columns: 2,
      name: "Asumsi",
      rows: [
        { 0: { value: "Item" }, 1: { value: "Nilai" } },
        { 0: { value: "Target tahunan" }, 1: { value: "3,000,000,000" } },
      ],
      truncated: false,
    },
    {
      columns: 2,
      name: "KPI",
      rows: [
        { 0: { value: "Total" }, 1: { formula: "=SUM(B2:B6)", value: "100%" } },
      ],
      truncated: false,
    },
  ],
};

test("file card opens its preview and offers a separate download action", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let previews = 0;
  let downloads = 0;

  try {
    await act(async () =>
      root.render(
        <FilePreviewCard
          artifact={{
            filename: "report.xlsx",
            mimeType: "application/octet-stream",
            path: "report.xlsx",
            savedAt: "",
            sizeBytes: 42,
          }}
          isImage={false}
          isVideo={false}
          onDownload={() => {
            downloads++;
          }}
          onOpen={() => {
            previews++;
          }}
        />
      )
    );
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="Preview report.xlsx"]')!
        .click()
    );
    expect(previews).toBe(1);
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="Open report.xlsx"]')!
        .click()
    );
    expect(previews).toBe(2);
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>(
          '[aria-label="More actions for report.xlsx"]'
        )!
        .click()
    );

    const download = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((entry) => entry.textContent?.includes("Download"))!;

    expect(download).toBeDefined();
    await act(async () => download.click());
    expect(downloads).toBe(1);
    expect(previews).toBe(2);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

test("uploaded Markdown opens read-only with download, fullscreen and close", async () => {
  const uuid = spyOn(crypto, "randomUUID").mockImplementation(() => {
    throw new Error("Not available in this context");
  });

  const element = document.createElement("div");
  const root = createRoot(element);

  const file = {
    filename: "notes.md",
    mediaType: "text/markdown",
    url: `data:text/markdown;charset=utf-8;base64,${btoa("# Read only notes")}`,
  };

  function Harness() {
    const [panel, setPanel] = useState<ChatAttachmentPanelConfig | null>(null);

    const show = useCallback(
      (next: ChatAttachmentPanelConfig) => setPanel(next),
      []
    );

    const hide = useCallback(() => setPanel(null), []);

    const update = useCallback(
      (id: string, patch: Partial<ChatAttachmentPanelConfig>) =>
        setPanel((current) =>
          current?.id === id ? { ...current, ...patch } : current
        ),
      []
    );

    // SAFETY: This fixture supplies the only auth field read by the preview, activeOrg.
    const auth = { activeOrg: { id: "org-preview" } } as AuthContextValue;

    return (
      <AuthContext.Provider value={auth}>
        <ChatAttachmentPanelContext.Provider
          value={{
            activeId: panel?.id ?? null,
            hide,
            isFullscreen: panel?.fullscreen ?? false,
            isOpen: panel !== null,
            requestRestore: () => () => undefined,
            show,
            update,
          }}
        >
          <DocumentAttachmentPreview document={file} />
          {panel ? (
            <section aria-label="File panel">
              {panel.headerActions}
              <button onClick={hide} type="button">
                Close
              </button>
              {panel.content}
            </section>
          ) : null}
        </ChatAttachmentPanelContext.Provider>
      </AuthContext.Provider>
    );
  }

  try {
    await act(async () =>
      root.render(
        <ThemeProvider>
          <Harness />
        </ThemeProvider>
      )
    );
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="Preview notes.md"]')!
        .click()
    );

    for (
      let attempt = 0;
      attempt < 30 && !element.querySelector("h1");
      attempt++
    ) {
      await act(async () => {
        await Bun.sleep(20);
      });
    }

    expect(element.querySelector("h1")?.textContent).toBe("Read only notes");
    expect(
      element.querySelector("input,textarea,[contenteditable=true]")
    ).toBeNull();
    expect(
      element.querySelector('[aria-label="Download notes.md"]')
    ).not.toBeNull();
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="Enter fullscreen"]')!
        .click()
    );
    expect(
      element.querySelector('[aria-label="Exit fullscreen"]')
    ).not.toBeNull();
    await act(async () =>
      Array.from(element.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Close")!
        .click()
    );
    expect(element.querySelector('[aria-label="File panel"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    uuid.mockRestore();
  }
});

test("switches sheets, shows selected cached values/formulas, and changes zoom without editing", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);

  try {
    await act(async () => root.render(<WorkbookGrid workbook={workbook} />));
    expect(element.textContent).toContain("Target tahunan");
    // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
    await act(async () =>
      (
        element.querySelector(
          '[aria-label="B2: 3,000,000,000"]'
        ) as HTMLButtonElement
      ).click()
    );
    expect(element.querySelector("output")?.textContent).toBe("3,000,000,000");
    // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
    await act(async () =>
      (
        Array.from(element.querySelectorAll('[role="tab"]')).find(
          (entry) => entry.textContent === "KPI"
        ) as HTMLButtonElement
      ).click()
    );
    expect(element.querySelector('[aria-selected="true"]')?.textContent).toBe(
      "KPI"
    );
    // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
    await act(async () =>
      (
        element.querySelector('[aria-label="B1: 100%"]') as HTMLButtonElement
      ).click()
    );
    expect(element.querySelector("output")?.textContent).toBe("=SUM(B2:B6)");
    const select = element.querySelector("select")!;
    await act(async () => {
      select.value = "150";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(element.querySelector("table")?.style.fontSize).toBe("19.5px");
    expect(
      element.querySelector("input,textarea,[contenteditable=true]")
    ).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

test("cell selection leaves unrelated worksheet rows untouched", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  let reads = 0;

  const stableCell = {
    get value() {
      reads++;

      return "Stable";
    },
  };

  const sheet = {
    columns: 2,
    name: "Performance",
    rows: [
      { 0: { value: "First" } },
      { 0: { value: "Next" } },
      { 0: stableCell },
    ],
    truncated: false,
  };

  try {
    await act(async () =>
      root.render(<WorkbookGrid workbook={{ sheets: [sheet] }} />)
    );
    const initialReads = reads;
    expect(initialReads).toBeGreaterThan(0);
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="A2: Next"]')!
        .click()
    );
    expect(element.querySelector("output")?.textContent).toBe("Next");
    expect(reads).toBe(initialReads);
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="A2: Next"]')!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", {
            bubbles: true,
            key: "ArrowRight",
          })
        )
    );
    expect(
      element.querySelector('[aria-label="B2: "]')?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(reads).toBe(initialReads);
  } finally {
    await act(async () => root.unmount());
  }
});

test("preview uses available mobile width and clamps desktop widths", () => {
  expect(clampAttachmentPanelWidth(768, 390)).toBe(390);
  expect(clampAttachmentPanelWidth(768, 767)).toBe(767);
  expect(clampAttachmentPanelWidth(768, 900)).toBe(450);
  expect(clampAttachmentPanelWidth(1600, 1440)).toBe(1080);
});

test("uploaded CSV opens in the spreadsheet table", async () => {
  const uuid = spyOn(crypto, "randomUUID").mockImplementation(() => {
    throw new Error("Not available in this context");
  });

  const element = document.createElement("div");
  const root = createRoot(element);

  const file = {
    filename: "inventory.csv",
    mediaType: "application/csv",
    url: `data:application/csv;base64,${btoa("SKU,Warehouse\nQM-0921,Medan\n")}`,
  };

  function Harness() {
    const [panel, setPanel] = useState<ChatAttachmentPanelConfig | null>(null);

    const show = useCallback(
      (next: ChatAttachmentPanelConfig) => setPanel(next),
      []
    );

    const hide = useCallback(() => setPanel(null), []);

    // SAFETY: This fixture supplies the only auth field read by the preview, activeOrg.
    const auth = { activeOrg: { id: "org-preview" } } as AuthContextValue;

    return (
      <AuthContext.Provider value={auth}>
        <ChatAttachmentPanelContext.Provider
          value={{
            activeId: panel?.id ?? null,
            hide,
            isFullscreen: false,
            isOpen: panel !== null,
            requestRestore: () => () => undefined,
            show,
            update: () => undefined,
          }}
        >
          <DocumentAttachmentPreview document={file} />
          {panel ? <section>{panel.content}</section> : null}
        </ChatAttachmentPanelContext.Provider>
      </AuthContext.Provider>
    );
  }

  try {
    await act(async () =>
      root.render(
        <ThemeProvider>
          <Harness />
        </ThemeProvider>
      )
    );
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>(
          '[aria-label="Preview inventory.csv"]'
        )!
        .click()
    );

    for (
      let attempt = 0;
      attempt < 30 && !element.querySelector("table");
      attempt++
    ) {
      await act(async () => {
        await Bun.sleep(20);
      });
    }

    const cells = Array.from(element.querySelectorAll("table td")).map(
      (cell) => cell.textContent
    );

    expect(cells).toContain("QM-0921");
    expect(cells).toContain("Medan");
  } finally {
    await act(async () => root.unmount());
    uuid.mockRestore();
  }
});

test("an upload panel stays open and toggles fullscreen after its card unmounts", async () => {
  const uuid = spyOn(crypto, "randomUUID").mockImplementation(() => {
    throw new Error("Not available in this context");
  });

  const element = document.createElement("div");
  const root = createRoot(element);

  const file = {
    filename: "inventory.csv",
    mediaType: "text/csv",
    url: `data:text/csv;base64,${btoa("SKU,Warehouse\nQM-0921,Medan\n")}`,
  };

  function Harness() {
    const [panel, setPanel] = useState<ChatAttachmentPanelConfig | null>(null);
    const [cardShown, setCardShown] = useState(true);

    const show = useCallback(
      (next: ChatAttachmentPanelConfig) => setPanel(next),
      []
    );

    const hide = useCallback(() => setPanel(null), []);

    const update = useCallback(
      (id: string, patch: Partial<ChatAttachmentPanelConfig>) =>
        setPanel((current) =>
          current?.id === id ? { ...current, ...patch } : current
        ),
      []
    );

    // SAFETY: This fixture supplies the only auth field read by the preview, activeOrg.
    const auth = { activeOrg: { id: "org-preview" } } as AuthContextValue;

    return (
      <AuthContext.Provider value={auth}>
        <ChatAttachmentPanelContext.Provider
          value={{
            activeId: panel?.id ?? null,
            hide,
            isFullscreen: panel?.fullscreen ?? false,
            isOpen: panel !== null,
            requestRestore: () => () => undefined,
            show,
            update,
          }}
        >
          {cardShown ? <DocumentAttachmentPreview document={file} /> : null}
          <button onClick={() => setCardShown(false)} type="button">
            Unmount card
          </button>
          {panel ? (
            <section aria-label="File panel">{panel.headerActions}</section>
          ) : null}
        </ChatAttachmentPanelContext.Provider>
      </AuthContext.Provider>
    );
  }

  const button = (label: string) =>
    element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

  try {
    await act(async () =>
      root.render(
        <ThemeProvider>
          <Harness />
        </ThemeProvider>
      )
    );
    await act(async () => button("Preview inventory.csv")!.click());
    await act(async () =>
      Array.from(element.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Unmount card")!
        .click()
    );

    expect(element.querySelector('[aria-label="File panel"]')).not.toBeNull();

    await act(async () => button("Enter fullscreen")!.click());
    expect(button("Exit fullscreen")).not.toBeNull();

    await act(async () => button("Exit fullscreen")!.click());
    expect(button("Enter fullscreen")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    uuid.mockRestore();
  }
});
