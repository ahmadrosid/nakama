import { describe, expect, test } from "bun:test";
import type { ListTimezonesResponse } from "@nakama/core/contract";
import {
  findTimezoneEntry,
  getFilteredTimezoneGroups,
  getTimezoneDisplay,
} from "./timezones";

const catalog: ListTimezonesResponse = {
  groups: [
    {
      countryCode: "ID",
      countryName: "Indonesia",
      timezones: [
        {
          abbreviation: "WIB",
          aliases: ["Jakarta Raya"],
          city: "Jakarta",
          countryCode: "ID",
          countryName: "Indonesia",
          id: "Asia/Jakarta",
          label: "Jakarta · UTC+07:00",
          offset: "UTC+07:00",
          tzName: "Western Indonesia Time",
        },
      ],
    },
  ],
};

describe("timezone helpers", () => {
  test("finds and displays a timezone entry", () => {
    expect(findTimezoneEntry("Asia/Jakarta", catalog)?.label).toBe(
      "Jakarta · UTC+07:00"
    );
    expect(getTimezoneDisplay("Asia/Jakarta", "Select timezone", catalog)).toBe(
      "Jakarta · UTC+07:00"
    );
  });

  test("filters timezone groups by search term", () => {
    expect(getFilteredTimezoneGroups("jakarta", catalog)).toHaveLength(1);
    expect(getFilteredTimezoneGroups("nonexistent", catalog)).toHaveLength(0);
  });
});
