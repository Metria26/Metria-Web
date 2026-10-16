<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Low-RAM Rules (Important)

This machine has limited RAM. Use as little memory as possible and run only what is essential for the task.

- Do not start the dev server (`next dev`), build (`next build`), or tests unless the task truly requires it. Prefer reading and editing code instead.
- Never run more than one heavy process at a time. If a dev server is already running, reuse it; do not start another.
- Stop any server or watcher you started as soon as you are done with it.
- Do not run `next build`, full type-checks, or full lint over the whole project. Check only the files you changed (e.g. `npx tsc --noEmit` only when needed, `npx eslint <file>`).
- Do not install new dependencies unless required. Avoid heavy packages.
- Do not run multiple subagents or parallel tasks. Work sequentially.
- Read only the files and line ranges you need. Do not load large files, lockfiles, `node_modules`, `.next`, or build output into context.
- Avoid broad searches across the repo. Search specific folders (e.g. `app/`, `components/`).
- Do not open a browser or run Playwright/Puppeteer/Cypress unless explicitly asked.
- Prefer small, targeted changes over large refactors.
- If a command is likely to use a lot of memory, ask before running it.