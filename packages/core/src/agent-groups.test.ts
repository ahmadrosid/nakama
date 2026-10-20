import { describe, expect, test } from "bun:test";
import {
  memberHandles,
  mentionedMemberIds,
  mentionRanges,
  mentionSuggestions,
} from "./agent-groups";

const handles = memberHandles([
  { id: "p1", name: "Writer" },
  { id: "p2", name: "Writer" },
  { id: "p3", name: "Ads Manager" },
  { id: "p4", name: "研究" },
]);

describe("memberHandles", () => {
  test("slugifies names and suffixes duplicates", () => {
    expect([...handles]).toEqual([
      ["writer", "p1"],
      ["writer-2", "p2"],
      ["ads-manager", "p3"],
      ["profile", "p4"],
    ]);
  });
});

describe("mentionedMemberIds", () => {
  test("returns mentions in order without duplicates", () => {
    expect(
      mentionedMemberIds(
        "@ads-manager, ask @Writer. Then @ads-manager again",
        handles
      )
    ).toEqual(["p3", "p1"]);
  });

  test("keeps @writer-2 apart from @writer", () => {
    expect(mentionedMemberIds("over to @writer-2", handles)).toEqual(["p2"]);
  });

  test("ignores emails, unknown handles, and the author", () => {
    expect(
      mentionedMemberIds(
        "mail me@writer.com, see x.com/@writer-2, ping @nobody and @writer-22, @writer",
        handles,
        "p1"
      )
    ).toEqual([]);
  });
});

describe("@all", () => {
  test("wakes every member, in member order", () => {
    expect(mentionedMemberIds("@all status?", handles)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  test("is ignored when an agent writes it", () => {
    expect(mentionedMemberIds("@all and @writer-2", handles, "p1")).toEqual([
      "p2",
    ]);
  });

  test("belongs to a member literally named All", () => {
    const named = memberHandles([
      { id: "a", name: "All" },
      { id: "b", name: "Bea" },
    ]);

    expect(mentionedMemberIds("@all", named)).toEqual(["a"]);
  });
});

describe("mentionRanges", () => {
  test("returns each mention with its position and member", () => {
    expect(mentionRanges("hi @Ads-Manager and @writer", handles)).toEqual([
      { end: 15, handle: "ads-manager", id: "p3", start: 3 },
      { end: 27, handle: "writer", id: "p1", start: 20 },
    ]);
  });
});

describe("mentionSuggestions", () => {
  test("offers handles that start with the query, members before @all", () => {
    expect(mentionSuggestions("wr", handles)).toEqual(["writer", "writer-2"]);
    expect(mentionSuggestions("a", handles)).toEqual(["ads-manager", "all"]);
  });

  test("offers nothing once the query names a member", () => {
    expect(mentionSuggestions("Writer-2", handles)).toEqual([]);
    expect(mentionSuggestions("writer", handles)).toEqual([]);
  });
});
