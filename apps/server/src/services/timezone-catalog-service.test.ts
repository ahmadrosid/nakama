import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  getTimezoneCatalog,
  resetTimezoneCatalogCache,
} from "./timezone-catalog-service";

afterEach(() => {
  resetTimezoneCatalogCache();
});

test("groups IANA zones by tzdata country", async () => {
  const catalog = await getTimezoneCatalog();
  const hasTzdata = [
    "/usr/share/zoneinfo/zone1970.tab",
    "/usr/share/zoneinfo/zone.tab",
  ].some(existsSync);
  const unitedStates = catalog.groups.find(
    (group) => group.countryCode === (hasTzdata ? "US" : "ZZ")
  );
  const ids = new Set(unitedStates?.timezones.map((zone) => zone.id));
  const newYork = unitedStates?.timezones.find(
    (zone) => zone.id === "America/New_York"
  );

  expect(unitedStates).toBeDefined();
  expect(newYork?.city).toBe("New York");
  expect(newYork?.offset.startsWith("UTC")).toBe(true);
  expect(newYork?.aliases).toContain("NYC");
  expect(
    ids.has("America/Indiana/Indianapolis") || ids.has("America/Indianapolis")
  ).toBe(true);
  expect(
    ids.has("America/Kentucky/Louisville") || ids.has("America/Louisville")
  ).toBe(true);
});
