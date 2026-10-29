import { describe, expect, test } from "bun:test";
import { assignHandles, groupRoster } from "./agent-groups";

const profiles = [
  { id: "p1", name: "Writer" },
  { id: "p2", name: "Writer" },
  { id: "p3", name: "Ads Manager" },
  { id: "p4", name: "研究" },
];

const memberIds = ["p1", "p2", "p3", "p4"];

const handles = assignHandles({}, memberIds, profiles);

const roster = groupRoster({ handles, memberIds }, profiles);

describe("assignHandles", () => {
  test("slugifies names and suffixes duplicates", () => {
    expect(handles).toEqual({
      p1: "writer",
      p2: "writer-2",
      p3: "ads-manager",
      p4: "profile",
    });
  });

  test("keeps saved handles and never reuses one", () => {
    // p2 left; a new Writer joins.
    const next = assignHandles(
      handles,
      ["p1", "p3", "p5"],
      [...profiles, { id: "p5", name: "Writer" }]
    );

    expect(next).toMatchObject({
      p1: "writer",
      p2: "writer-2",
      p5: "writer-3",
    });
  });

  test("keeps a handle when the agent is renamed", () => {
    expect(
      assignHandles(handles, memberIds, [{ id: "p1", name: "Editor" }]).p1
    ).toBe("writer");
  });
});

describe("groupRoster", () => {
  test("keeps handles when a member loses access", () => {
    const reachable = profiles.filter((profile) => profile.id !== "p1");
    const after = groupRoster({ handles, memberIds }, reachable);

    expect(after.members.map((member) => member.id)).toEqual([
      "p2",
      "p3",
      "p4",
    ]);
    expect(after.handleOf("p2")).toBe("writer-2");
    expect(after.mentions("over to @writer-2")).toEqual(["p2"]);
    // The handle of the member out of reach wakes nobody.
    expect(after.mentions("@writer, then @writer-2")).toEqual(["p2"]);
  });

  test("old mentions keep their agent after a membership change", () => {
    const next = assignHandles(
      handles,
      ["p2", "p5"],
      [...profiles, { id: "p5", name: "Writer" }]
    );

    const after = groupRoster({ handles: next, memberIds: ["p2", "p5"] }, [
      ...profiles,
      { id: "p5", name: "Writer" },
    ]);

    expect(after.mentions("@writer-2 ping")).toEqual(["p2"]);
    expect(after.mentions("@writer ping")).toEqual([]);
    expect(after.idOf("writer-3")).toBe("p5");
  });

  test("web and server get the same roster from the same inputs", () => {
    // The web list keeps Super Nakama; the server list drops it.
    const superNakama = { id: "s", isSuper: true, name: "Super Nakama" };
    const group = { handles, memberIds: [...memberIds, "s"] };
    const web = groupRoster(group, [...profiles, superNakama]);
    const server = groupRoster(group, profiles);

    expect(web.members).toEqual(server.members);
    expect(memberIds.map(web.handleOf)).toEqual(memberIds.map(server.handleOf));
    expect(web.mentions("@all")).toEqual(server.mentions("@all"));
  });

  test("gives a group saved without handles the handles it had", () => {
    expect(
      groupRoster({ handles: {}, memberIds }, profiles).handleOf("p2")
    ).toBe("writer-2");
  });

  test("ignores a member that is not a profile here", () => {
    expect(
      groupRoster({ handles, memberIds: ["gone", "p3"] }, profiles).members
    ).toEqual([{ id: "p3", name: "Ads Manager" }]);
  });
});

describe("mentions", () => {
  test("returns mentions in order without duplicates", () => {
    expect(
      roster.mentions("@ads-manager, ask @Writer. Then @ads-manager again")
    ).toEqual(["p3", "p1"]);
  });

  test("keeps @writer-2 apart from @writer", () => {
    expect(roster.mentions("over to @writer-2")).toEqual(["p2"]);
  });

  test("ignores emails, unknown handles, and the author", () => {
    expect(
      roster.mentions(
        "mail me@writer.com, see x.com/@writer-2, ping @nobody and @writer-22, @writer",
        "p1"
      )
    ).toEqual([]);
  });
});

describe("@all", () => {
  test("wakes every member, in member order", () => {
    expect(roster.mentions("@all status?")).toEqual(["p1", "p2", "p3", "p4"]);
  });

  test("is ignored when an agent writes it", () => {
    expect(roster.mentions("@all and @writer-2", "p1")).toEqual(["p2"]);
  });

  test("belongs to a member literally named All", () => {
    const named = [
      { id: "a", name: "All" },
      { id: "b", name: "Bea" },
    ];

    const ids = ["a", "b"];

    expect(
      groupRoster({ handles: {}, memberIds: ids }, named).mentions("@all")
    ).toEqual(["a"]);
  });
});

describe("ranges", () => {
  test("returns each mention with its position and member", () => {
    expect(roster.ranges("hi @Ads-Manager and @writer")).toEqual([
      { end: 15, handle: "ads-manager", id: "p3", start: 3 },
      { end: 27, handle: "writer", id: "p1", start: 20 },
    ]);
  });
});

describe("suggestions", () => {
  test("offers handles that start with the query, members before @all", () => {
    expect(roster.suggestions("wr")).toEqual(["writer", "writer-2"]);
    expect(roster.suggestions("a")).toEqual(["ads-manager", "all"]);
  });

  test("offers nothing once the query names a member", () => {
    expect(roster.suggestions("Writer-2")).toEqual([]);
    expect(roster.suggestions("writer")).toEqual([]);
  });
});
