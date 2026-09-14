# Monocle Launcher

Launcher-only fork of Modrinth App. Keep upstream license/copyright notices and use Monocle or generic artwork, never restricted upstream branding assets.

## Projects

- apps/app: Tauri desktop shell and local bot-host adapter.
- apps/app-frontend: Vue 3 operations console, accounts and Minecraft instance UI.
- packages/app-lib: Theseus Minecraft installation/process/account library.
- Other retained packages are launcher dependencies; do not add website or backend projects.

Read a package's AGENTS.md when editing it, and follow relevant standards/frontend instructions. Reuse the existing host API; do not duplicate workflow/coordinator logic in the launcher.

## Editing

Use tabs for source indentation. Keep changes scoped, preserve user edits, and use apply_patch. Do not add heading comments or speculative abstractions.

## Checks

Run node apps/app/monocle-check.mjs and the bot-operations.check.mjs / bot-sessions.check.mjs checks in apps/app-frontend/src/helpers. Set JAVA_HOME before native builds.

Run pnpm prepr:frontend:app or pnpm prepr:frontend:lib only when requested or preparing an approved PR; do not use direct frontend typecheck/tsc commands for lint checks. Normal compile/build checks are allowed.

## Shell

Use rg for file/text searches. Do not pipe output through head, tail, less or more. Prefer command-specific output limits. Do not create unrelated Bash/SQL scripts.
