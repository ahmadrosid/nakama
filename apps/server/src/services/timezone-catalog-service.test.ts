import { describe, expect, test } from "bun:test";
import {
  getTimezoneCatalog,
  resetTimezoneCatalogCache,
} from "./timezone-catalog-service";

describe("TimezoneCatalogService", () => {
  test("returns grouped timezone catalog entries", async () => {
    resetTimezoneCatalogCache();
    const catalog = await getTimezoneCatalog();

    expect(catalog.groups.length).toBeGreaterThan(100);

    const indonesia = catalog.groups.find(
      (group) => group.countryCode === "ID"
    );
    expect(indonesia).toBeDefined();

    const jakarta = indonesia?.timezones.find(
      (entry) => entry.id === "Asia/Jakarta"
    );
    expect(jakarta).toMatchObject({
      abbreviation: "WIB",
      city: "Jakarta",
      countryCode: "ID",
      id: "Asia/Jakarta",
      offset: "UTC+07:00",
      tzName: "Western Indonesian Time",
    });
    expect(jakarta?.label).toContain("Jakarta");
  });

  test("includes searchable aliases for cities without their own IANA zone", async () => {
    resetTimezoneCatalogCache();
    const catalog = await getTimezoneCatalog();

    const unitedStates = catalog.groups.find(
      (group) => group.countryCode === "US"
    );
    const losAngeles = unitedStates?.timezones.find(
      (entry) => entry.id === "America/Los_Angeles"
    );

    expect(losAngeles?.aliases).toContain("San Francisco");
  });
});
