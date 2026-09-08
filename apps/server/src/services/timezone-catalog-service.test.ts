import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  getTimezoneCatalog,
  resetTimezoneCatalogCache,
} from "./timezone-catalog-service";

afterEach(() => {
  resetTimezoneCatalogCache();
});

async function usZones() {
  const catalog = await getTimezoneCatalog();
  return catalog.groups.find((group) => group.countryCode === "US")?.timezones;
}

test("groups IANA zones by tzdata country", async () => {
  const unitedStates = await usZones();
  const newYork = unitedStates?.find((zone) => zone.id === "America/New_York");

  expect(unitedStates).toBeDefined();
  expect(newYork?.city).toBe("New York");
  expect(newYork?.offset.startsWith("UTC")).toBe(true);
  expect(newYork?.aliases).toContain("NYC");
});

test("skips zone.tab ids the runtime ICU does not accept", async () => {
  const catalog = await getTimezoneCatalog();
  const ids = catalog.groups.flatMap((group) =>
    group.timezones.map((zone) => zone.id)
  );

  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    expect(
      () => new Intl.DateTimeFormat(undefined, { timeZone: id })
    ).not.toThrow();
  }
});

test("includes IANA zones that Intl omits", async () => {
  const unitedStates = await usZones();
  const ids = new Set(unitedStates?.map((zone) => zone.id));

  expect(ids.has("America/Indiana/Indianapolis")).toBe(true);
  expect(ids.has("America/Indiana/Knox")).toBe(true);
  expect(ids.has("America/Kentucky/Louisville")).toBe(true);
});

test("keeps country groups when tzdata files are missing", async () => {
  const readFileSync = spyOn(fs, "readFileSync").mockImplementation(() => {
    throw new Error("ENOENT");
  });

  try {
    const catalog = await getTimezoneCatalog();
    const unitedStates = catalog.groups.find(
      (group) => group.countryCode === "US"
    );
    const ids = new Set(unitedStates?.timezones.map((zone) => zone.id));

    expect(unitedStates?.countryName).toBe("United States");
    expect(ids.has("America/New_York")).toBe(true);
    expect(ids.has("America/Indiana/Indianapolis")).toBe(true);
    expect(
      catalog.groups.some(
        (group) =>
          group.countryCode === "ZZ" &&
          group.timezones.some((zone) => zone.id === "America/New_York")
      )
    ).toBe(false);
  } finally {
    readFileSync.mockRestore();
  }
});
