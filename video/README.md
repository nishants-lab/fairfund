# Monthly fund buying video

A 36-second vertical video (1080x1920) of the latest month in the fund buying report,
made with [Remotion](https://www.remotion.dev/) from `../src/data/holdings_report.json`.

It is a separate project so the site build never installs or bundles Remotion.

## Render a new month

After the data refresh has built a new report:

```
npm ci
npm run render
```

This writes `public/media/fund-buying-YYYY-MM.mp4`, a poster image next to it, and
`src/data/report_video.json`, which tells the report page which month the video covers.
The previous month's files are removed. Commit those three changes.

Set `REMOTION_BROWSER` to a local Chrome or chrome-headless-shell binary to skip
Remotion's browser download.

## Preview and edit

```
npm run studio
```

Scenes live in `src/FundBuying.tsx`; the numbers they show come from `props.mjs`.
`node render.mjs --stills` writes one frame per scene to `out/` for a quick review.
