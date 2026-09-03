import { describe, expect, test } from "bun:test";
import type { StoredTask } from "@nakama/core/contract";
import {
  createFormStateFromTask,
  taskDetailFooterActions,
  taskDetailFormReducer,
} from "./TaskDetailDialog";

const TASK = {
  description: "nightly",
  id: "task-1",
  profileId: "profile-1",
  prompt: "do the thing",
  title: "Nightly report",
} as StoredTask;

describe("taskDetailFormReducer delete confirmation", () => {
  test("starts without a pending delete", () => {
    expect(createFormStateFromTask(TASK).confirmingDelete).toBe(false);
  });

  test("askDelete arms the confirmation instead of deleting", () => {
    const next = taskDetailFormReducer(createFormStateFromTask(TASK), {
      type: "askDelete",
    });

    expect(next.confirmingDelete).toBe(true);
  });

  test("cancelDelete disarms it", () => {
    const armed = taskDetailFormReducer(createFormStateFromTask(TASK), {
      type: "askDelete",
    });

    expect(
      taskDetailFormReducer(armed, { type: "cancelDelete" }).confirmingDelete
    ).toBe(false);
  });

  test("editing a field does not disarm the confirmation", () => {
    const armed = taskDetailFormReducer(createFormStateFromTask(TASK), {
      type: "askDelete",
    });
    const edited = taskDetailFormReducer(armed, {
      type: "patch",
      values: { title: "Renamed" },
    });

    expect(edited.confirmingDelete).toBe(true);
    expect(edited.title).toBe("Renamed");
  });

  test("switching to another task clears a pending delete", () => {
    const armed = taskDetailFormReducer(createFormStateFromTask(TASK), {
      type: "askDelete",
    });
    const synced = taskDetailFormReducer(armed, {
      task: { ...TASK, id: "task-2", title: "Other" } as StoredTask,
      type: "sync",
    });

    expect(synced.confirmingDelete).toBe(false);
    expect(synced.title).toBe("Other");
  });
});

describe("taskDetailFooterActions", () => {
  test("offers Delete, Run and Save before anything is armed", () => {
    expect(taskDetailFooterActions({ confirmingDelete: false })).toEqual({
      showConfirmDelete: false,
      showDelete: true,
      showRunAndSave: true,
    });
  });

  test("offers only the confirmation once Delete is armed", () => {
    // The regression this guards: the delete used to run on the first click.
    // Nothing else may be reachable while the decision is on screen, or a
    // mis-click could run or save the task mid-confirmation.
    expect(taskDetailFooterActions({ confirmingDelete: true })).toEqual({
      showConfirmDelete: true,
      showDelete: false,
      showRunAndSave: false,
    });
  });

  test("arming through the reducer is what flips the footer", () => {
    const armed = taskDetailFormReducer(createFormStateFromTask(TASK), {
      type: "askDelete",
    });

    expect(taskDetailFooterActions(armed).showRunAndSave).toBe(false);
    expect(taskDetailFooterActions(armed).showConfirmDelete).toBe(true);
  });
});
