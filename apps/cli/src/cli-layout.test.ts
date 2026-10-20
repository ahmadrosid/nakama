import { describe, expect, test } from "bun:test";
import { createSerializedQueue } from "./message-queue";

describe("createSerializedQueue", () => {
  test("runs tasks one after another", async () => {
    const queue = createSerializedQueue();
    const order: number[] = [];

    const first = queue.enqueue(async () => {
      await Bun.sleep(20);
      order.push(1);
    });

    const second = queue.enqueue(async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  test("continues after a rejected task", async () => {
    const queue = createSerializedQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push("a");
      throw new Error("fail");
    });

    const second = queue.enqueue(async () => {
      order.push("b");
    });

    await expect(first).rejects.toThrow("fail");
    await second;
    expect(order).toEqual(["a", "b"]);
  });
});
