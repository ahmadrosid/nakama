import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createClientId, syncRowKeys } from "./client-id";

const secureCrypto = globalThis.crypto;

function useCrypto(value: Crypto | Pick<Crypto, "getRandomValues">): void {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value,
    writable: true,
  });
}

afterEach(() => {
  useCrypto(secureCrypto);
});

describe("createClientId", () => {
  test("uses crypto.randomUUID when the context exposes it", () => {
    const uuid = spyOn(crypto, "randomUUID").mockImplementation(
      () => "00000000-0000-4000-8000-000000000000"
    );

    expect(createClientId()).toBe("00000000-0000-4000-8000-000000000000");
    expect(uuid).toHaveBeenCalledTimes(1);
    uuid.mockRestore();
  });

  test("still returns unique ids when randomUUID is missing (insecure context)", () => {
    // Browsers drop randomUUID outside secure contexts but keep getRandomValues.
    useCrypto({
      getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto),
    });

    const first = createClientId();
    const second = createClientId();

    expect(first).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(second).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(first).not.toBe(second);
  });

  test("falls back when randomUUID throws", () => {
    const uuid = spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });

    expect(createClientId()).toMatch(/^[0-9A-Za-z]{21}$/);
    uuid.mockRestore();
  });
});

describe("syncRowKeys", () => {
  test("middle splice keeps sibling keys stable after remove-and-readd", () => {
    const keys: string[] = [];
    syncRowKeys(keys, 3);
    const [first, , third] = keys;

    keys.splice(1, 1);
    syncRowKeys(keys, 2);
    expect(keys).toEqual([first, third]);

    syncRowKeys(keys, 3);
    expect(keys[0]).toBe(first);
    expect(keys[1]).toBe(third);
    expect(keys[2]).not.toBe(first);
    expect(keys[2]).not.toBe(third);
  });
});
