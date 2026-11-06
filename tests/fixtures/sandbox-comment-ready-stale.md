<!-- preview-sandbox -->
<!-- sandbox-stale -->
> [!WARNING]
> **This sandbox is behind the PR head (`0ae60fc`).** It still serves the commit it was last built from.
> Comment `/sandbox` to rebuild before reviewing or applying `qa-approved`.
<!-- /sandbox-stale -->

## <img src="https://example.test/logo-icon.svg" height="22" align="top"> Sandbox ready

**[Open Dashboard ↗](https://dashboard-fixture.example.test)** · **[Open Admin ↗](https://admin-fixture.example.test)** · **[API health ↗](https://api-server-pr-1242.example.test/health)**

| Resource | Notes |
| --- | --- |
| [Dashboard](https://dashboard-fixture.example.test) | Real login, wired to the sandbox API |
| [Admin](https://admin-fixture.example.test) | Reads the sandbox API and database directly |
| [API](https://api-server-pr-1242.example.test) | Railway environment `pr-1242` |
| Database | Neon branch `preview/pr-1242` — copy-on-write fork of staging, writes never leave it |
| Background jobs | Inngest branch env `pr-1242` — event-driven jobs plus explicitly allowlisted, fork-scoped crons |

<sub>Updated Nov 5, 10:35 UTC · `3a5a2ab` · pushes do not rebuild, comment `/sandbox` to refresh · `/sandbox down` or removing the `preview:sandbox` label tears everything down · idle sandboxes are reaped automatically</sub>
