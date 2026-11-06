# Open questions

Questions we cannot answer without GC (or a decision from our side). Each one is tagged in the code or templates as `TODO(GC:<topic>)`. Where we had to proceed, the default we took is noted.

## Settled

| Topic | Decision |
|---|---|
| `okta-verifier`, `token-exchange` | GC's own code is reused as is: GC's Okta guard validates the user, and GC's existing Okta-to-Databricks token service gives each user's Databricks token. We do not build our own Okta adapters (phase 4 dropped). The NestJS module template adapts GC's token service to our `TokenProvider` |
| UI | The chat page is embedded in GC's UI and calls our API with the user's Okta bearer token |

## Open

| Topic | Question | Default we took |
|---|---|---|
| `token-exchange` | The name and import path of GC's token service, and the method that returns a user's Databricks token | Template assumes `DatabricksTokenService.getTokenForUser(oktaToken)` |
| `okta-guard` | The name and import path of GC's Okta guard, and the user shape it puts on the request | Template assumes `OktaAuthGuard` and `req.user.sub` |
| `nest-paths` | Which NestJS app hosts the core: a new app on Node 22 (`apps/conversational-bi`), or GC's API once it runs Node 22.13 or later | A new app; `lift.mjs` copies to `apps/conversational-bi` |
| Node version | GC's API is on Node 20; Mastra needs 22.13 or later | The app runs on its own Node 22 runtime |
| `zod` | GC's zod version, if dependencies are merged into one root `package.json` | We use zod 4 |
| `model-endpoint` | Is GC's model endpoint OpenAI-compatible? Which model, and a key or a managed identity? | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` |
| `route-prefix` | Does GC's API use a global prefix, and is `/bi` free? | `BI_ROUTE_PREFIX`, default `/bi` |
| `vault` | Which Vault paths hold the model key, and how they reach the pod | Environment variables only |
| Embedding | Is the page embedded as React code in GC's UI, or shown in a frame? | Either works; for a frame set `BI_FRAME_ANCESTORS` |
| Spaces | The 5 Genie space ids, names and descriptions (and optional routing text) for dev, QC, UAT and production | Spaces file plus `BI_SPACE_ID_<KEY>` per environment |
| Domain rules | Who owns the business rules text, and who signs off changes | The example file holds today's rules |
| State | Conversation memory across pods: a shared store GC already runs (MongoDB?) or session affinity | Memory in the pod; session affinity (phase 5) |
| Datadog | Whether GC wants LLM traces (LangSmith or Mastra's exporters) besides logs | Logs only |
