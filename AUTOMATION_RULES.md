# Automation rules

Every scheduled automation follows these. They are here rather than repeated in each
prompt so there is one place to change them.

You are modifying the software that runs you. Nobody is watching while you work.

## Start of every run

1. `git fetch` then `git rebase master`. If it conflicts: `git rebase --abort`, note it
   in `AUTOMATION_BACKLOG.md`, and stop for today.
2. If `node_modules` is missing, or `package-lock.json` is newer than
   `node_modules/.package-lock.json`, run `npm install` at the repo root before anything
   else. The rebase can bring in a dependency change; skipping this makes every later
   step fail on a stale install instead of the real regression it's there to catch.
3. Run `npm test` in `apps/orchestrator`. If tests fail on a clean tree that is a real
   regression — fix it and commit that instead of your planned work. A broken suite
   blinds every future run.

## End of every run

- Commit your work to the current branch with a specific message.
- If nothing was worth doing, commit nothing and say so. An honest empty result is
  better than invented work, and much better than padding.

## Verification before committing code

- `npm test` in `apps/orchestrator`.
- `npx tsc --noEmit -p tsconfig.json` in every app you changed.
- If `apps/web` fails with `Cannot find name 'LayoutProps'`, run `npx next build` in
  `apps/web` first, then re-run the typecheck.
- If you cannot get everything green, `git checkout -- .` to revert, record why in the
  Notes section of `AUTOMATION_BACKLOG.md`, and commit only that file.

## Never

- Never push, merge, rebase onto anything but master, or switch branches. Stay on
  `jarvis/auto` and commit locally.
- Never touch anything under `scripts/`, and never start, stop, or re-register
  scheduled tasks.
- Never delete or modify `jarvis.db` or `jarvis.key` anywhere on this machine.
- Never run `npm run dev`, `next dev`, or anything binding ports 3000 or 4317 — the
  live service owns those.
- Never edit files outside this working directory.
- Against the live orchestrator on port 4317, use GET only. Never POST, PATCH, or
  DELETE.

## Judgement

- Do exactly one substantive thing per run. Depth beats breadth here.
- Prefer the boring correct change over the clever one.
- If a fact you need is missing, stop and write down the question rather than guessing.
