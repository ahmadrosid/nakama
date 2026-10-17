import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { passwordStrength, SetupStepAccount } from "./SetupStepAccount";
import type { SetupAccountDraft } from "./setup-wizard.shared";

let container: HTMLDivElement;

let root: Root;

let submitted: SetupAccountDraft[];

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  submitted = [];

  await act(async () =>
    root.render(
      <MemoryRouter>
        <SetupStepAccount onNext={(account) => submitted.push(account)} />
      </MemoryRouter>
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function input(id: string) {
  return container.querySelector<HTMLInputElement>(`#${id}`);
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label
  );

  if (!found) {
    throw new Error(`No button labelled ${label}`);
  }

  return found;
}

async function type(element: HTMLInputElement | null, value: string) {
  if (!element) {
    throw new Error("Input not rendered");
  }

  const setValue = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value"
  )?.set;

  await act(async () => {
    setValue?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector("form");

  await act(async () => {
    form?.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

test("phone stays hidden until asked for and submits without a confirm field", async () => {
  expect(input("setup-phone")).toBeNull();
  expect(input("setup-confirm")).toBeNull();

  await type(input("setup-name"), " Jane Admin ");
  await type(input("setup-email"), "admin@example.com");
  await type(input("setup-password"), "kopi-pagi-42");
  await submit();

  expect(submitted).toEqual([
    {
      email: "admin@example.com",
      name: "Jane Admin",
      password: "kopi-pagi-42",
      phone: "",
    },
  ]);

  await act(async () => button("+ Add phone").click());
  await type(input("setup-phone"), "+628123456789");
  await submit();

  expect(submitted[1]?.phone).toBe("+628123456789");
});

test("short passwords are not submitted", async () => {
  await type(input("setup-password"), "short");
  await submit();

  expect(submitted).toEqual([]);
});

test("the eye button reveals and hides the password", async () => {
  expect(input("setup-password")?.type).toBe("password");

  await act(async () => button("Show password").click());
  expect(input("setup-password")?.type).toBe("text");

  await act(async () => button("Hide password").click());
  expect(input("setup-password")?.type).toBe("password");
});

test("password strength grows with length and character kinds", () => {
  expect(passwordStrength("short")).toBe(0);
  expect(passwordStrength("abcdefgh")).toBe(1);
  expect(passwordStrength("abcdefg1")).toBe(2);
  expect(passwordStrength("abcdef1!")).toBe(3);
  expect(passwordStrength("Abcdefgh12!x")).toBe(4);
});
