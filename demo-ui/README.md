# Demo page (temporary)

The chat page with fewer features, for an interim client update: the same look as the main UI (it is built from the main UI's own components), but it shows only the question, the answer, the data table and the chart data as JSON. No scratchpad, no drawn charts, no follow-up suggestions.

- The page is in `ui/demo` and is built to `ui/dist-demo` by `npm run build`, next to the main UI.
- `npm start` serves it on http://localhost:1977 (`DEMO_PORT` changes it); the main UI stays on http://localhost:1976. The demo forwards `/bi` and `/auth` to the main server, so both use the same API.
- If Databricks login is on (`DATABRICKS_CLIENT_ID`), sign in once on the main UI; the demo page then works too.

The main UI's code is not changed by the demo.

## Removing it

1. Delete the folders `demo-ui` and `ui/demo`, and the file `ui/vite.demo.config.ts`.
2. In `run.mjs`, delete the lines marked `DEMO-UI`.
3. In `.gitignore`, delete the `ui/dist-demo` line.
