# Configuration in GC

For the engineers who deploy Conversational BI in GC (dev, QC, UAT, production). All settings are environment variables, set through Helm values (plain settings) and Vault (secrets). Nothing is baked into the image. The complete list with defaults is `server/.env.example`, generated from the code. The service checks every setting at start and stops with one message that names each wrong setting, without echoing values.

## Must be set

| Setting | Value | Provided by |
|---|---|---|
| `BI_MODE` | `gc` | Helm |
| `DATABRICKS_SERVER_HOSTNAME` | The workspace host of the environment | Helm, per environment |
| `BI_SPACES_FILE` or `BI_SPACES_JSON` | The list of Genie spaces (see below) | A ConfigMap mounted as a file, or Helm |
| `BI_SPACE_ID_<KEY>` | The Genie space id of each space, per environment (one variable per space key, key in capitals) | Helm, per environment |
| `LLM_BASE_URL`, `LLM_MODEL` | GC's OpenAI-compatible model endpoint and model | Helm |
| `LLM_API_KEY` | The key for that endpoint, if it needs one | Vault |
| `ANTHROPIC_API_KEY` | Only when Anthropic is used directly instead of `LLM_BASE_URL` | Vault |

Not allowed in gc mode (the service refuses to start): `DATABRICKS_TOKEN` (a shared token) and `UI_DIST`. Each user's Databricks token comes from GC's own Okta-to-Databricks token service, per request.

## The spaces file

One entry per Genie space (example: `server/config/examples/spaces.example.json`). Adding a space is a change to this file and one `BI_SPACE_ID_<KEY>` variable, with no code change.

```json
[
  {
    "key": "placement",
    "name": "Placement Core",
    "description": "What the space holds, and what it does not. The assistant routes questions by this text.",
    "routing": "Optional: when to send a question here, if the description is not enough.",
    "spaceId": "REPLACE_ME"
  }
]
```

Write each description for the routing: say what the space holds and what it does not hold, so the assistant can tell similar spaces apart. Business rules that apply to every space (what "Year" means, units, status order) go in the domain rules file (`BI_DOMAIN_RULES_FILE`), mounted like the spaces file.

## Usually left at the default

| Setting | Default | Change when |
|---|---|---|
| `GENIE_MODE` | `conversation` | Set `agent` to stream Genie's reasoning live (recommended) |
| `BI_ROUTE_PREFIX` | `/bi` | The host already uses `/bi` |
| `BI_LOG_FORMAT`, `BI_LOG_LEVEL` | `json`, `info` in gc mode | Debugging; keep `BI_LOG_CONTENT=false` in shared environments |
| `BI_MAX_CONCURRENT_PER_USER`, `BI_MAX_CONCURRENT_TOTAL` | 2, 50 per pod | Sizing (each running question holds one model stream and Genie calls) |
| `BI_TURN_TIMEOUT_MS` | 300000 (5 min) | Genie is regularly slower |
| `BI_SSE_HEARTBEAT_MS` | 15000 | The ingress idle timeout is shorter than 20 s |
| `BI_SHUTDOWN_GRACE_MS` | 25000 | Keep it below the pod's `terminationGracePeriodSeconds` (default 30 s) |
| `BI_CORS_ORIGINS` | none in gc mode | The UI calls the API from another origin |
| `BI_FRAME_ANCESTORS` | `'self'` | The page is shown in a frame of GC's UI |
| `BI_ENABLED` | `true` | Switch the feature off without a deployment |

## Kubernetes

- Probes: liveness `GET /health/live`, readiness `GET /health/ready` (when the NestJS template is used, GC's own health checks instead).
- The ingress must not buffer the answer stream. The service sends `X-Accel-Buffering: no`; check that the ingress honours it, and that its read timeout is longer than the heartbeat.
- Logs go to stdout as JSON; see `DATADOG.md`.
- State (conversation memory) is in the pod for now. Keep one pod per user session (session affinity) until the shared state store is decided (see the report, phase 5).
