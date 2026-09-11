import { afterEach, expect, test } from "bun:test";
import type * as UI from "@nakama/ui";
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { apply } from "./ui";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) {
    await act(async () => renderer!.unmount());
    renderer = undefined;
  }
});
const primitives = Object.fromEntries(
  [
    "Button",
    "Input",
    "Textarea",
    "Select",
    "SelectTrigger",
    "SelectValue",
    "SelectContent",
    "SelectItem",
    "Dialog",
    "DialogContent",
    "DialogHeader",
    "DialogTitle",
  ].map((name) => [
    name,
    (props: Record<string, unknown>) =>
      React.createElement(name, props, props.children as React.ReactNode),
  ])
) as unknown as typeof UI;
async function mount(
  call: (action: string, input?: unknown) => Promise<unknown>
) {
  let Page: React.ComponentType | undefined;
  apply({
    host: { call },
    React,
    signal: new AbortController().signal,
    slots: {
      register: (_slot, component) => {
        Page = component;
      },
    },
    styles: () => {},
    ui: primitives,
  });
  await act(async () => {
    renderer = create(React.createElement(Page!));
  });
  return renderer!;
}
const profiles = {
  canConfigure: true,
  configured: true,
  profiles: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
};
function button(view: ReactTestRenderer, label: string) {
  return view.root.findAll(
    (node) => String(node.type) === "Button" && node.props.children === label
  )[0]!;
}

test("members see setup unavailable without credential controls", async () => {
  const view = await mount(async () => ({
    ...profiles,
    canConfigure: false,
    configured: false,
  }));
  expect(JSON.stringify(view.toJSON())).toContain("Ask an admin");
  expect(
    view.root.findAll(
      (node) => String(node.type) === "Input" && node.props.type === "password"
    )
  ).toHaveLength(0);
});

test("switching agents discards a late response from the previous agent", async () => {
  let resolveAlice: ((value: unknown) => void) | undefined;
  const view = await mount(async (action, input) => {
    if (action === "profiles") {
      return profiles;
    }
    if ((input as { agentId: string }).agentId === "alice") {
      return new Promise((resolve) => {
        resolveAlice = resolve;
      });
    }
    return {
      items: [{ id: "bob-doc", source: "", state: "ready", title: "Bob only" }],
    };
  });
  await act(async () => {
    view.root
      .findByType("Select" as React.ElementType)
      .props.onValueChange("bob");
  });
  await act(async () => {
    resolveAlice!({
      items: [{ id: "alice-doc", state: "ready", title: "Private Alice" }],
    });
  });
  expect(JSON.stringify(view.toJSON())).toContain("Bob only");
  expect(JSON.stringify(view.toJSON())).not.toContain("Private Alice");
});

test("an uncertain save retains its submission key when retried", async () => {
  const saves: Record<string, unknown>[] = [];
  const view = await mount(async (action, input) => {
    if (action === "profiles") {
      return profiles;
    }
    if (action === "remember") {
      saves.push(input as Record<string, unknown>);
      return { id: "one", state: "unknown", title: "Tea" };
    }
    return { items: [] };
  });
  await act(async () => button(view, "Remember").props.onClick());
  await act(async () =>
    view.root
      .findByType("Textarea" as React.ElementType)
      .props.onChange({ target: { value: "Prefers tea" } })
  );
  const submit = () =>
    view.root
      .findAllByType("form")
      .find((form) => form.props.className.includes("sm-card"))!
      .props.onSubmit({ preventDefault: () => {} });
  await act(submit);
  await act(submit);
  expect(saves).toHaveLength(2);
  expect(saves[0]!.submissionKey).toBe(saves[1]!.submissionKey);
  expect(JSON.stringify(view.toJSON())).toContain("Save outcome unresolved");
});

test("forget uses the selected local id", async () => {
  const removed: unknown[] = [];
  const view = await mount(async (action, input) => {
    if (action === "profiles") {
      return profiles;
    }
    if (action === "forget_memory") {
      removed.push(input);
      return { id: "second", state: "forgotten" };
    }
    return {
      items: [
        { id: "first", state: "ready", title: "One" },
        { id: "second", state: "ready", title: "Two" },
      ],
    };
  });
  await act(async () =>
    view.root
      .findAll(
        (node) =>
          String(node.type) === "Button" && node.props.children === "Forget"
      )[1]!
      .props.onClick()
  );
  expect(removed).toEqual([{ agentId: "alice", id: "second" }]);
  expect(JSON.stringify(view.toJSON())).toContain("One");
  expect(JSON.stringify(view.toJSON())).not.toContain('"Two"');
});

test("a slower file read cannot replace a newer selection", async () => {
  const view = await mount(async (action) =>
    action === "profiles" ? profiles : { items: [] }
  );
  await act(async () => button(view, "Knowledge").props.onClick());
  await act(async () => button(view, "Add text").props.onClick());
  let release: ((value: ArrayBuffer) => void) | undefined;
  const first = {
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      }),
    name: "old.txt",
    size: 3,
  };
  const second = {
    arrayBuffer: async () => new TextEncoder().encode("new").buffer,
    name: "new.txt",
    size: 3,
  };
  const input = view.root.findAll(
    (node) => String(node.type) === "Input" && node.props.type === "file"
  )[0]!;
  await act(async () => input.props.onChange({ target: { files: [first] } }));
  await act(async () => input.props.onChange({ target: { files: [second] } }));
  await act(async () => release!(new TextEncoder().encode("old").buffer));
  expect(
    view.root.findByType("Textarea" as React.ElementType).props.value
  ).toBe("new");
});

test("pending document polling pauses when hidden and stops on unmount", async () => {
  const originalTimeout = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const scheduled = new Map<number, () => Promise<void>>();
  let timerId = 0;
  let visibility: (() => void) | undefined;
  const page = {
    addEventListener: (_name: string, callback: () => void) => {
      visibility = callback;
    },
    hidden: false,
    removeEventListener: () => {
      visibility = undefined;
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: page,
  });
  globalThis.setTimeout = ((
    callback: () => Promise<void>,
    delay: number,
    ...args: unknown[]
  ) => {
    if (delay === 5000) {
      scheduled.set(++timerId, callback);
      return timerId;
    }
    return originalTimeout(callback, delay, ...args);
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    if (scheduled.delete(Number(id))) {
      return;
    }
    originalClear(id);
  }) as typeof clearTimeout;
  try {
    const view = await mount(async (action) =>
      action === "profiles"
        ? profiles
        : { items: [{ id: "doc", state: "pending", title: "Guide" }] }
    );
    await act(async () => button(view, "Knowledge").props.onClick());
    expect(scheduled.size).toBe(1);
    await act(async () => {
      page.hidden = true;
      visibility!();
    });
    expect(scheduled.size).toBe(0);
    await act(async () => {
      page.hidden = false;
      visibility!();
    });
    expect(scheduled.size).toBe(1);
    await act(async () => view.unmount());
    renderer = undefined;
    expect(scheduled.size).toBe(0);
    expect(visibility).toBeUndefined();
  } finally {
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClear;
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
});
