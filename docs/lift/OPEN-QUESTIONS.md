# Open questions

Questions we cannot answer without GC (or a decision from our side). Each one is tagged in the code as `TODO(GC:<topic>)`. Where we had to proceed, the safest default is noted.

| Topic | Question | Default we took |
|---|---|---|
| `okta-verifier` | Which Okta issuer, audience and allowed client ids does GC's API validate? Can the standalone service reuse GC's JWT verifier settings? | gc mode refuses to start until the Okta adapter is wired in (Phase 4). |
| `token-exchange` | What exact token-exchange request does GC's Okta POC and Databricks federation policy accept (endpoint, `subject_token_type`, scope, client id)? | Not built yet (Phase 4); will default to RFC 8693 against the workspace `/oidc/v1/token`. |
| `model-endpoint` | Is GC's model endpoint OpenAI-compatible (chat completions)? Which model name, and is a key or a managed identity used? | `openai-compatible` with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. |
| `nest-paths` | Will the core live in `apps/conversational-bi` (standalone) or inside `apps/api`? This sets the import paths in the Nest templates. | Standalone (`apps/conversational-bi`), because GC's API runs Node 20 and Mastra needs 22.13 or later. |
| `okta-guard` | What is the name and import path of GC's Okta guard, and what user shape does it put on the request? | Template assumes `OktaAuthGuard` and `req.user.sub`. |
| `route-prefix` | Does GC's API use a global prefix, and is `/bi` free? | `BI_ROUTE_PREFIX`, default `/bi`. |
| `vault` | Which Vault paths hold the model key and any client secret, and how do they reach the pod (env vars from Helm)? | Settings are read from environment variables only. |
| Spaces | The 5 Genie space ids, names and descriptions (and optional routing text) for dev, QC and UAT. | Loaded from `BI_SPACES_FILE`/`BI_SPACES_JSON`; the repository only has the 2 example spaces with `REPLACE_ME` ids. |
| Domain rules | Who owns the business rules text (`BI_DOMAIN_RULES_FILE`), and who signs off changes to it? | The example file holds today's rules. |
