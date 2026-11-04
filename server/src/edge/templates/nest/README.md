# NestJS templates

Two plain-text templates for hosting the Conversational BI core inside GC's NestJS API (`apps/api`). They are not compiled in this repository. Every place that needs a GC-specific decision is marked `TODO(GC:<topic>)`.

| File | Goes to | What it does |
|---|---|---|
| `bi.controller.ts.template` | `apps/api/src/conversational-bi/bi.controller.ts` | `POST bi/chat` (SSE) and `POST bi/feedback`. Takes the Okta user and bearer token that GC's guard has already validated, builds a `BiRequestContext`, calls `handleChat`, and writes each event as `data: <json>\n\n`. It sends a heartbeat comment every 15 s and aborts the turn when the client disconnects. |
| `bi.module.ts.template` | `apps/api/src/conversational-bi/bi.module.ts` | Loads the configuration in `gc` mode, builds the service once and provides it to the controller. |

## When to use them

**Inside GC's API (these templates).** This works only if GC's API runs on **Node 22.13 or later**, because the core runs on Mastra, which requires it. GC's API is on Node 20 today. You also need to merge our dependencies into GC's root `package.json` (see `deps.manifest.json`). The benefit is one deployable, GC's existing Okta guard, and no extra service.

**Standalone (the default).** Run our Mastra service as its own app (`apps/conversational-bi`), with its own image and Helm release, on Node 22. GC's API or UI calls it over HTTP with the user's Okta bearer token. There is no Node upgrade and no dependency merge, but there is one more service to deploy, monitor and secure. Okta validation is then done by our `OktaBearerAuthenticator` (`adapters/gc`), configured with the same issuer and audience as GC's API.

Either way the event stream (`docs/CONTRACT.md`) is identical, so the UI does not care which one is used.
