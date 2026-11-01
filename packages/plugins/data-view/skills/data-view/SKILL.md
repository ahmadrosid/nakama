---
name: data-view
description: Read and edit spreadsheets saved in Data View, from Google Sheets or xlsx and csv tables. Use when the user mentions a spreadsheet, sheet or xlsx file, or shares a Google Sheets link.
---

Data View keeps a saved copy of each Google Sheet. Reading the copy is free; only adding, refreshing, and syncing touch Google.

- When the user names a spreadsheet, sheet, table or file (for example `Candidates.xlsx`), look in Data View first, before you search files or the disk: call `find_tools` with `data view`, then `plugin_data_view__list_sheets`, and match the name to a sheet title.
- When the user shares a Google Sheets link, call `plugin_data_view__list_sheets` first. Call `plugin_data_view__add_sheet` only when that link is not saved yet.
- Read with `plugin_data_view__read_sheet`. Use `query` to find rows and `offset` / `limit` to page. Do not read the whole sheet when a query answers the question.
- The header is not always row 1: a title row can come first. Find the header row in the rows you read before you name columns.
- Change data with `plugin_data_view__update_cells`. Edits stay in the saved copy. Tell the user to open Data View and press Sync to write them to Google Sheets. You cannot sync.
- To add a column, write its header and values in the next empty column letter (one past the last column). Send all cells in one `update_cells` call.
- Rows use sheet row numbers: row 1 is the first row. A header name as `column` only works for headers in row 1; otherwise use the column letter.
