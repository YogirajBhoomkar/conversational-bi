# NestJS templates

Two plain-text templates for hosting the Conversational BI core in a NestJS app of GC's monorepo. They are not compiled in this repository. Every place that needs a GC-specific name or path is marked `TODO(GC:<topic>)`.

| File | Goes to | What it does |
|---|---|---|
| `bi.controller.ts.template` | `apps/<app>/src/conversational-bi/bi.controller.ts` | `POST bi/chat` (SSE), `POST bi/feedback`, `GET bi/version`, behind GC's Okta guard. Uses the core's admission (per-user and total limits, refusal on shutdown), trace ids, request logger and error rules, so it behaves exactly like the Mastra routes (`docs/CONTRACT.md`). |
| `bi.module.ts.template` | `apps/<app>/src/conversational-bi/bi.module.ts` | Loads the configuration in `gc` mode, adapts GC's existing Okta-to-Databricks token service to the core's `TokenProvider`, builds the service once, and drains on shutdown. |

## Where it runs

The core runs on Mastra, which needs **Node 22.13 or later**.

- **A NestJS app on Node 22 in GC's monorepo** (for example `apps/conversational-bi`), reusing GC's auth library and token service. This is the path these templates are for.
- **Inside GC's existing API**, only once that API runs on Node 22.13 or later, with our dependencies merged into the root `package.json` (`lift/deps.manifest.json`).

Either way the HTTP contract is identical, so the UI does not care which one is used. GC's UI embeds the chat page and calls these routes with the user's Okta bearer token.

Health checks: NestJS apps in GC usually have their own (`@nestjs/terminus`). Readiness should also report not ready once `BiShutdown` has drained the admission (`admission.ready()`).
