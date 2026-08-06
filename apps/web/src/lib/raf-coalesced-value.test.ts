import { describe, expect, test } from "bun:test";
import { RafValueCoalescer } from "./raf-coalesced-value";

function flushCoalesceTurn(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  return Promise.resolve(); // microtask fallback runs before the next await tick
}

describe("RafValueCoalescer", () => {
  test("coalesces multiple set() calls into one flush", async () => {
    const flushed: string[] = [];
    const coalescer = new RafValueCoalescer("", (value) => {
      flushed.push(value);
    });

    coalescer.set("a");
    coalescer.set("ab");
    coalescer.set("abc");

    expect(flushed).toEqual([]);

    await flushCoalesceTurn();

    expect(flushed).toEqual(["abc"]);
  });

  test("sync publishes immediately and cancels a pending flush", async () => {
    const flushed: string[] = [];
    const coalescer = new RafValueCoalescer("", (value) => {
      flushed.push(value);
    });

    coalescer.set("partial");
    coalescer.sync("final");

    expect(flushed).toEqual(["final"]);

    await flushCoalesceTurn();

    expect(flushed).toEqual(["final"]);
  });

  test("cancel drops a pending flush without publishing", async () => {
    const flushed: string[] = [];
    const coalescer = new RafValueCoalescer("", (value) => {
      flushed.push(value);
    });

    coalescer.set("lost");
    coalescer.cancel();

    await flushCoalesceTurn();

    expect(flushed).toEqual([]);
  });
});
