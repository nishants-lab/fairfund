# QA — Pre-Push Checklist

Run every item before pushing. A green local run that skips these has burned us before.

## Build / types (non-negotiable)
- [ ] `npm run build` (NOT `vite build` alone). CI runs `tsc -b && vite build`.
      `vite build` uses esbuild and does NOT type-check, so it passes on real
      type errors. Always run the full `tsc -b` gate locally, exit code 0.
- [ ] No new TypeScript errors introduced in changed files.

## Data sanity (when data/pipeline changed)
- [ ] Changed numbers spot-checked against source (NAV, returns, availability,
      capture ratios). No impossible values (capture=0, drawdown deeper than NAV
      history, recovery longer than the series, closed flags without a recent date).
- [ ] Flags/statuses carry a recent as-of date and the UI gates on it.

## Runtime / UX
- [ ] Load a changed fund page as a repeat visitor (service worker cached).
- [ ] Open a shared `/f/` link and confirm it renders (not a blank shell).
- [ ] The specific card/badge that changed renders with real data, not just compiles.

## Push
- [ ] Commit author email is the GitHub noreply, never the amazon address.
- [ ] After push, confirm the Actions run for the pushed SHA is `success`
      before calling it live. Never assert "live" from memory.
