<p align="center">
	<img src="apps/app-frontend/src/assets/monocle-logo.png" alt="Monocle Launcher" width="520">
</p>

# Monocle Launcher

An independent Minecraft launcher forked from [Modrinth App](https://github.com/modrinth/code), for the Monocle client and its bot operations platform. Not affiliated with or endorsed by Modrinth/Rinth, Inc.

Launcher version: **0.1.0-alpha.4**. Launcher and client versions are independent.

## Stage 1

- Monocle application icon, splash/welcome logo, titles, and fork attribution.
- Separate application identifier, database, accounts, logs, caches, and default instances directory.
- Monocle instance shortcuts use `monocle://`; the fork does not register the stock `modrinth://` scheme.
- Stock launcher auto-updates and upstream analytics/error reporting, surveys, ads, and Discord Rich Presence are disabled. Mod/project updates still use the upstream catalog.
- Upstream account, instance, import, installation, and launch functionality retained. Importing existing instances is an explicit user action, not an automatic migration.

## Stage 2 · Bot control room

The **Bots** sidebar page connects to the existing Java host API: workers and diagnostics, crews and progress, workflow-package dispatch, job pause/resume/cancel, and separate deletable history. No workflow/coordinator logic is reimplemented in Rust. In-game hosting remains supported by Monocle Client.

Select a host data directory and choose/find/install Java 25. **Save & connect** attaches to an already-running local host using its protected configuration; it does not take ownership or restart it. For a new host, **Initialize new host**, then **Start bundled host**. The bundled development host version is 0.7.30. Configuration/credentials and journals remain in the selected directory; the launcher stores only directory and Java paths in `bot-host-settings.json`.

New hosts default to loopback worker port 6969 and API port 6970. Set LAN binding, ports and additional crew keys in `host-config.json` before starting. **Reveal crew keys** exposes worker keys only on request; the operator API token never enters the frontend. Managed service output goes to `launcher-host.log` in its data directory. The service continues running when the launcher closes, so closing a console does not interrupt jobs; a reopened launcher can connect to it as an external host. Stop is restricted to the process owned by that launcher session, with no active jobs or pending worker cleanup.

## Operations console

The fleet dashboard uses a graphite-and-gold command rail, live operation progress, searchable worker cards, a crew board, an attention panel and a bounded activity feed. Filter the overview by crew, inspect a worker, or pause/retry a job without leaving the dashboard. Disconnected snapshots are marked as last known and job controls are disabled. These panels use the existing host snapshots and commands; the redesign adds no worker protocol or background job behavior.

**Overview / Crews / Jobs / Workflows / Workers / Settings** separates operating work from connection setup. Crews have stable identifiers and editable names; create/delete crews and move idle workers with an authenticated, sealed key update. Active queues, containers and pending cleanup block reassignment rather than orphaning work. Job history is hidden inside Jobs, with retention configurable in Settings (30 days by default).

Create highway jobs with origin, direction, length or exact endpoint, width/height, work sharing, speed, inventory targets, shulker retention and speculative building rates. Save work unassigned, then **Assign crew** to claim it, or start immediately. Travel, TPA, dropping items, waiting and selecting captured profiles have typed inputs; custom workflows use JSON arguments. Pause/resume/cancel and per-worker priorities remain host-authoritative. Cleanup stays visible in active operations until acknowledged. **Release crew · keep job** retains verified highway progress as protected unassigned work; another assignment waits for cancellation and recovery to finish.

The shared `OperationsLibrary` provides immutable built-in templates, folders, imported captures, editable duplicates, Lua source editing and advanced package/profile editing. Use `.bot export-workflow <id>` to import complete client configuration. Built-in templates inherit worker settings, with only explicit highway-form overrides synchronized; import a capture to synchronize all gameplay settings. Overrides merge into existing SNBT groups without duplicate groups or resetting unrelated values. Monocle Client 0.7.28 can import/copy/queue the same portable packages from its Workflows tab.

Worker observations are deduplicated and retained offline without claiming live position/verification. The dashboard exposes worker blockers, inventory, action tokens, priorities, checkpoint diagnostics and bounded host activity. Unconfirmed assignments retain their original UUID/request for retry; disconnected or unsaved connections disable controls. Earlier hosts remain monitorable but must be updated while idle to enable the new management API.

Active-job worker borrowing still uses workflow priorities, not forced crew-key changes during container recovery. Remote host attachment and managed-service ownership across launcher restarts remain future work. This build has been compiled on macOS; Windows/Linux compile and native lifecycle testing are still required before a public cross-platform release.

## Stage 3 · Worker sessions

Worker execution details now include **Live gameplay settings**: Speed, AutoEat (including enchanted golden apples/named food), or a gameplay module with partial SNBT settings. Changes use the shared host `configure` operation, not local config-file replacement. Pending/applied/rejected revisions stay visible, and concurrent updates are blocked until acknowledged. Requires host and workers supporting client 0.7.50; job-owned builder geometry is intentionally excluded. Personal settings are restored on job exit.

The **Workers** section binds each observed worker to a local Minecraft account and instance, with an optional server to join. Import/create an instance, install Monocle, configure its Worker connection, and connect once before binding. Bindings persist locally in `bot-worker-sessions.json`; passwords, tokens and host crew keys are not copied into that file.

**Launch game** uses the explicitly bound account without switching the launcher's default account. **Launch stopped sessions** starts available bindings sequentially, skips already-running instances and workers connected elsewhere, and reports individual failures without blocking the remaining launches. Each account and instance can belong to only one binding. Save pending edits before launching; running bindings cannot be edited or removed.

Game-process status and worker-network status remain separate, including a running game awaiting crew connection. **Session logs** opens the existing live/historical console; **Open instance** provides the usual installation/settings controls. **Stop game** requires confirmation and stops only that local game, not its host job. The host retains its normal departure/recovery logic. Sessions are never automatically launched, restarted or stopped when opening/closing the operations panel.

Remote workers remain unmanaged by this launcher's local process controls. Embedded worker windows and low-rendering/background session management are the next stage; games still have separate windows. Actual multi-account launches and Windows lifecycle behavior still need live testing.

## Development

Requires Node >=24.15, pnpm 10.33.2, the pinned Rust toolchain, Java, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

Set `JAVA_HOME` to a compatible installed JDK before building. Gradle's existing Foojay resolver downloads the Java 17 compilation toolchain when needed; the launcher Java helpers still target Java 8 bytecode for older Minecraft versions.

```sh
npx --yes pnpm@10.33.2 install --filter @modrinth/app... --frozen-lockfile
cp packages/app-lib/.env.prod packages/app-lib/.env
node apps/app/monocle-check.mjs
pnpm app:dev
```

The existing internal `@modrinth/*` packages and Theseus crate names are intentionally retained to keep upstream merges manageable. Catalog/Minecraft service endpoints remain upstream; no repository/backend fork is deployed in this stage.

Build from `apps/app` with `pnpm exec tauri build`. To compile without an installer, use `pnpm exec tauri build --debug --no-bundle`. Use the Monocle release config if overriding configuration; do not enable the upstream `updater` feature.

## Data isolation

The application identifier is `dev.monocle.launcher`. Defaults:

- macOS: `~/Library/Application Support/dev.monocle.launcher/`.
- Windows: `%APPDATA%\\dev.monocle.launcher\\`.
- Linux: `$XDG_DATA_HOME/dev.monocle.launcher/` (usually `~/.local/share/dev.monocle.launcher/`).

The SQLite database is `app.db`; default Minecraft instances are under `profiles/`. Only `MONOCLE_CONFIG_DIR` overrides the initial directory; an inherited `THESEUS_CONFIG_DIR` does not redirect this launcher into Modrinth's database. Explicitly choosing an existing data directory or importing instances can share files, so do not point Monocle at stock Modrinth's data directory.

Pre-migration database snapshots stay under that directory's `Backups/app-db/`; `MONOCLE_DB_BACKUP_DIR` can explicitly override their location.

## Upstream and licenses

Based on upstream commit `4d4f3bd129e7a88d81dee8c2583209f759964d71`, with the original checkout history and an `upstream` Git remote retained.

The desktop shell, app library, and frontend remain GPL-3.0-only; original LICENSE/COPYING notices are preserved in each package. Other monorepo packages retain their own licenses. Distributions must include applicable notices and provide corresponding source under those licenses. Monocle assets are copied from Monocle Client; Modrinth's restricted application branding is not used as this fork's identity.

This is a launcher-only fork: the desktop shell, frontend and required shared libraries remain. The website, backend services, documentation site, playground, restricted blog content and their deployment workflows have been removed. Original history is retained for attribution and upstream comparison. See [NOTICE.md](NOTICE.md) for modification dates and distribution notices.

Restricted upstream branding has been removed from the current tree, including shared logo/mascot components, repository covers and legacy launcher artwork. Shared components now use Monocle artwork or generic service icons; factual Modrinth catalog/account links and original legal attribution remain.
