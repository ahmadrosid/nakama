import { afterEach, expect, test } from "bun:test";
import {
  getTimezoneCatalog,
  resetTimezoneCatalogCache,
} from "./timezone-catalog-service";

afterEach(() => {
  resetTimezoneCatalogCache();
});

test("groups IANA zones by tzdata country", async () => {
  const catalog = await getTimezoneCatalog();
  const unitedStates = catalog.groups.find(
    (group) => group.countryCode === "US"
  );
  const ids = new Set(unitedStates?.timezones.map((zone) => zone.id));
  const newYork = unitedStates?.timezones.find(
    (zone) => zone.id === "America/New_York"
  );

  expect(unitedStates?.countryName).toBe("United States");
  expect(newYork?.city).toBe("New York");
  expect(newYork?.offset.startsWith("UTC")).toBe(true);
  expect(newYork?.aliases).toContain("NYC");
  expect(ids.has("America/Indiana/Indianapolis")).toBe(true);
  expect(ids.has("America/Kentucky/Louisville")).toBe(true);
});
