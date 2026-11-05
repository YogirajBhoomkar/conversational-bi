# Logs, trace ids and Datadog

For the platform team running Conversational BI in GC. The service writes structured logs to stdout. The Datadog agent on the node picks them up; nothing in the service talks to Datadog directly.

## Format

With `BI_MODE=gc` the format is JSON (one object per line) unless `BI_LOG_FORMAT` says otherwise. Every line has:

| Field | Meaning |
|---|---|
| `timestamp` | ISO 8601, UTC |
| `level` | `debug`, `info`, `warn` or `error` (`BI_LOG_LEVEL`, default `info`) |
| `message`, `event` | The event name, for example `chat.turn` (the same value twice: Datadog shows `message`, facets use `event`) |
| `service` | Always `conversational-bi` |
| `traceId` | On every line of a request. Taken from the caller's W3C `traceparent` header (the 32-character trace id) or `X-Trace-Id`, otherwise generated. Returned in the `X-Trace-Id` response header and in the `final` event |
| `user` | A 12-character one-way hash of the user id. The id itself (an email or Okta `sub`) is never logged |

What is never written: tokens, `Authorization` and cookie values, API keys, passwords and session ids. They are removed by field name and by shape (Databricks tokens, `sk-` keys, `Bearer …`, JWTs), anywhere in a line, including inside error messages. Question and answer text, SQL and rows are left out too (`[omitted]`), unless `BI_LOG_CONTENT=true`, which is for debugging only and should stay off in shared environments.

## Events

| Event | Level | Fields | When |
|---|---|---|---|
| `service.started` | info | `mode`, `port`, `spaces`, `genieMode`, `model` | Once at start |
| `config.warning` | warn | `warning` | A setting is ignored (a typo, a space id with no space) |
| `chat.turn` | info | `durationMs`, `firstAnswerMs`, `genieCalls`, `failedCalls`, `charts`, `rows`, `inputTokens`, `outputTokens` | Every answered question. Tokens are the supervisor's own model use |
| `chat.failed` | error | `durationMs`, `error` | A turn ended with an error |
| `chat.cancelled` | info | `durationMs` | The user left or stopped the turn |
| `genie.ask` | info | `space`, `durationMs`, `rows`, `charts`, `failed` | Every Genie call |
| `retry` | warn | `call`, `attempt`, `waitMs`, `error` | A Genie or Databricks call is tried again |
| `genie.chart_load_failed`, `genie.unparsed_cell`, `chart.skipped` | warn | `space`, `reason` | Genie sent a chart the app could not load or draw |
| `suggest.failed` | warn | `error` | Follow-up suggestions could not be written (the answer is unaffected) |
| `feedback`, `feedback.failed` | info, warn | `spaceId`, `rating` | A thumbs up or down was passed to Genie |

## Datadog setup (template)

Annotate the pod so the agent tags the logs (Helm values, replace `<container>` with the container name):

```yaml
podAnnotations:
  ad.datadoghq.com/<container>.logs: '[{"source": "nodejs", "service": "conversational-bi"}]'
```

In Datadog, add facets for `event`, `traceId`, `user`, `space` and measures for `durationMs`, `firstAnswerMs`, `inputTokens`, `outputTokens`. Suggested monitors:

| Monitor | Query |
|---|---|
| Failed turns | `service:conversational-bi event:chat.failed`, more than 5 in 10 minutes |
| Slow answers | p95 of `@durationMs` on `event:chat.turn` above 120000 |
| Genie trouble | `event:retry` or `@failed:true` on `event:genie.ask`, rising |

## Linking to GC's traces

If GC's API sends a W3C `traceparent` header when it calls this service (dd-trace does when W3C propagation is on), our `traceId` is the same trace id, so a search for it finds both sides. To find one user's problem, ask them for the trace id (the UI can show it from the `final` event) and search `@traceId:<id>`.

## Not included

- **LangSmith or another LLM tracing exporter.** No Mastra exporter for it is installed, so none was wired in. If GC wants LLM traces, the option is Mastra's observability exporters; it needs a decision and a dependency review first.
- **Token use of the data agents.** Only the supervisor's model use is logged.
