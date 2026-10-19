---
name: data-view
description: Read and edit Google Sheets through the Data View saved copy. Use when the user shares a Google Sheets link or asks about data in a sheet saved in Data View.
include-body-on-match: true
---

Data View keeps a saved copy of each Google Sheet. Reading the copy is free; only adding, refreshing, and syncing touch Google.

- When the user shares a Google Sheets link, call `plugin_data_view__list_sheets` first. Call `plugin_data_view__add_sheet` only when that link is not saved yet.
- Read with `plugin_data_view__read_sheet`. Use `query` to find rows and `offset` / `limit` to page. Do not read the whole sheet when a query answers the question.
- Change data with `plugin_data_view__update_cells`. Edits stay in the saved copy. Tell the user to open Data View and press Sync to write them to Google Sheets. You cannot sync.
- Rows use sheet row numbers: row 1 is the header, row 2 is the first data row. Use the header name as `column` when it is unique, else the column letter.
