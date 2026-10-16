import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  MeetAction,
  MeetActionInput,
  MeetActionResults,
  Meeting,
} from "@nakama/core/google-meet";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { GoogleMeetPage } from "./GoogleMeetPage";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function meeting(overrides: Partial<Meeting>): Meeting {
  return {
    actorId: "admin",
    createdAt: 1000,
    durationMinutes: 60,
    error: null,
    id: "meeting",
    profileId: null,
    state: "finished",
    stopRequested: 0,
    transcriptFile: "transcript.md",
    updatedAt: 61_000,
    url: "https://meet.google.com/abc-defg-hij",
    ...overrides,
  };
}

const meetings = [
  meeting({ id: "live", state: "recording", title: "Live sync" }),
  meeting({ id: "design", title: "Design review" }),
  meeting({ id: "acme", title: "Customer call" }),
];

// SAFETY: GoogleMeetPage reads only activeOrg and user from the auth context.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
} as AuthContextValue;

async function mountPage(recordings?: MeetActionResults["recordings"]) {
  // SAFETY: each branch returns the result shape of the action it handles.
  const invoke = spyOn(client, "invokeGoogleMeet").mockImplementation(((
    action: MeetAction,
    input?: MeetActionInput
  ) => {
    if (action === "meetings") {
      return Promise.resolve({
        canConfigure: true,
        captureProtocol: 1,
        configured: true,
        enabled: true,
        meetings,
      });
    }

    if (action === "transcript") {
      return Promise.resolve({
        meeting: meetings[0],
        nextCursor: 3,
        segments:
          input?.after === 0
            ? ["first", "second", "third"].map((text, sequence) => ({
                id: text,
                receivedAt: 0,
                sequence,
                speakerName: "Dina",
                text,
              }))
            : [],
      });
    }

    if (action === "recordings") {
      return Promise.resolve(recordings);
    }

    return Promise.resolve(meetings[0]);
  }) as typeof client.invokeGoogleMeet);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/google-meet"]}>
        <AuthContext.Provider value={auth}>
          <GoogleMeetPage />
        </AuthContext.Provider>
      </MemoryRouter>
    );
    await Bun.sleep(20);
  });

  cleanups.push(async () => {
    invoke.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  return { container, invoke };
}

async function type(input: HTMLInputElement | null, value: string) {
  await act(async () => {
    const view = input?.ownerDocument.defaultView;

    if (input && view) {
      Object.getOwnPropertyDescriptor(
        view.HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, value);
      input.dispatchEvent(new view.Event("input", { bubbles: true }));
    }
  });
}

test("a recording meeting shows its latest lines and can be stopped", async () => {
  const { container, invoke } = await mountPage();
  const preview = container.querySelector(".meet-live-preview");

  expect(preview?.textContent).toContain("third");
  expect(preview?.textContent).toContain("second");
  expect(preview?.textContent).not.toContain("first");

  const stop = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Stop")
  );

  await act(async () => {
    stop?.click();
    await Bun.sleep(10);
  });

  expect(invoke).toHaveBeenCalledWith(
    "leave",
    { meetingId: "live" },
    "org-a",
    expect.anything()
  );
});

test("history lists only finished meetings and filters by search", async () => {
  const { container } = await mountPage();

  const rows = () =>
    [...container.querySelectorAll(".meet-list .meet-meeting")].map(
      (row) => row.querySelector(".meet-meeting-title")?.textContent
    );

  expect(rows()).toEqual(["Design review", "Customer call"]);

  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search meetings"]'
  );

  await type(search, "acme call");

  expect(rows()).toEqual([]);

  await type(search, "customer");

  expect(rows()).toEqual(["Customer call"]);
});

test("recording picker imports the selected recording", async () => {
  const { container, invoke } = await mountPage({
    composioConfigured: true,
    driveConnected: true,
    gmailConnected: true,
    recordings: [
      {
        date: "2026-10-16",
        fileId: "first",
        messageId: "one",
        name: "First.mp4",
        size: 100,
      },
      {
        date: "2026-10-17",
        fileId: "second",
        messageId: "two",
        name: "Second.mp4",
        size: 200,
      },
    ],
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Import recording"))
      ?.click();
    await Bun.sleep(10);
  });

  const choices = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="recording"]'),
  ];

  expect(choices).toHaveLength(2);
  expect(choices[0]?.checked).toBe(true);

  await act(async () => choices[1]?.click());
  expect(choices[1]?.checked).toBe(true);

  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Import")
      ?.click();
    await Bun.sleep(10);
  });

  expect(invoke).toHaveBeenCalledWith(
    "import-recording",
    { fileId: "second", messageId: "two" },
    "org-a",
    expect.anything()
  );
});
