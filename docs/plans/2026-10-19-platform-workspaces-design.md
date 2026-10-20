# Platform Workspaces and Domestic Futures Data Import Design

> Status: superseded by `docs/superpowers/specs/2026-10-19-dual-platform-workspace-architecture.md`; retained as an early design record.

## Decision

The dashboard remains one local application, but every read and write is scoped to an active platform. The default platform is `mt5`; domestic futures uses `domestic_futures`, while `tonghuashun_futures` remains only a compatibility alias. Platform is a workspace context, not a list filter, so the dashboard, orders, album, classifications, settings, equity snapshots, and imports operate on one platform at a time.

## Data flow

```text
platform selector -> URL/local workspace state -> every API request
                                      |
                         MT5 bridge or domestic-futures data importer
                                      |
                              platform-scoped SQLite rows
                                      |
                 dashboard / orders / album / manual screenshot
```

Existing rows and MT5 events are assigned `mt5`. The CSV importer reads the default Tonghuashun CSV with BOM/GBK tolerance, maps Chinese column aliases, pairs futures opening and closing transactions FIFO, and creates closed trades. Rows that cannot be mapped or paired are reported in the import result.

## Scope

- Add a platform column to trade, deal, position, campaign, and equity data.
- Scope repository queries and campaign reconstruction by platform.
- Add `POST /api/platforms/import-file` with JSON `{platform, filename, file_base64}`.
- Add a platform switcher, standard template download and data file picker in the shared shell/settings workspace.
- Keep screenshot capture manual through the existing order detail upload control.
- Do not mix platform metrics or auto-capture screenshots.

## Risks

- A CSV export may not contain enough information to pair open/close transactions; the importer must report unpaired rows rather than invent trades.
- The exact Tonghuashun column labels can vary by export version, so aliases and an import preview/error report are required.
- Existing user changes in the working tree must remain untouched; all changes are additive and tested.
