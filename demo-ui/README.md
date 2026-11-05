# Demo page (temporary)

A deliberately simple page for an interim client update: ask a question, see the answer, the data table and the chart data as JSON. It uses the main server's API; it has no code of its own on the server and shares nothing with the main UI.

- `npm start` starts it next to the main app: main UI on http://localhost:1976, demo page on http://localhost:1977 (`DEMO_PORT` changes it).
- If Databricks login is on (`DATABRICKS_CLIENT_ID`), sign in once on the main UI; the demo page then works too.

## Removing it

1. Delete this `demo-ui` folder.
2. In `run.mjs`, delete the lines marked `DEMO-UI`.

Nothing else refers to it.
