# Conversational BI API contract (1.0.0)

For the engineers who embed the chat page in GC's UI or host the service. The machine-readable versions are generated from the code and cannot drift from it: `server/contracts/*.schema.json` (one JSON Schema per message) and `server/contracts/bi.openapi.yaml`. Regenerate with `npm run contracts`; a test fails when they are out of date.

The prefix is `BI_ROUTE_PREFIX` (default `/bi`).

## Identity

The host identifies the caller. In GC that is GC's Okta guard: send the user's Okta access token as `Authorization: Bearer <token>`. Locally it is a Databricks login cookie, or a shared development token. Without a valid identity the answer is `401` with `relogin: true`, and the UI should send the user to sign in again.

## POST {prefix}/chat

Ask a question. The answer streams back as Server-Sent Events.

Request (`chat-request.schema.json`):

```json
{ "threadId": "a-uuid-per-conversation", "message": "Which regions placed the most limit in 2024?" }
```

`threadId` keeps the conversation: send the same one for follow-up questions, and a new one for a new chat. Threads belong to the user who started them.

Response: `200`, `Content-Type: text/event-stream`. Each `data:` line holds one event as JSON (`chat-event.schema.json`). Lines starting with `:` are keep-alive comments and can be ignored.

| Event | Fields | Meaning |
|---|---|---|
| `trace` | `item` | One entry of the scratchpad (what the assistant is doing). An `item.id` sent again updates that entry. See below |
| `text` | `delta` | The next piece of the answer (Markdown). Append it |
| `text-reset` | | The text streamed so far was a working step after all: clear the answer |
| `final` | `result` | The complete answer (below). Sent once |
| `suggestions` | `questions` | Up to 3 follow-up questions. Can come before or after `final` |
| `error` | `message` | The turn failed. `message` can be shown as is; it includes a reference |

The stream ends after `final` (and `suggestions`, if any), or after `error`. Closing the connection stops the work on the server.

Scratchpad entries (`trace.item`):

| `kind` | Shown as | Fields |
|---|---|---|
| `note` | The assistant's plan, one sentence. An empty `text` means it became the answer: hide it | `text` |
| `tool` | One data source being asked | `label` (the source name), `text` (the question), `status` (`running`, `done`, `error`) |
| `progress` | A step of that source, under it (`parent` is the tool entry's id) | `step` (`thought`, `status`, `query`), `text`, `status` for queries |
| `meta` | Technical detail (the model used); not for end users | `label`, `text` |

The final answer (`final-answer.schema.json`):

| Field | Meaning |
|---|---|
| `answer` | The answer in Markdown |
| `columns`, `rows`, `totalRows` | The data table. `rows.length < totalRows` means it is a preview |
| `charts` | Every chart of the answer (`chart-spec.schema.json`), in order; empty means none. A chart is a library-neutral description: type, title, `x`, `y`, optional `color` and `path`, and the `data` rows |
| `chartSpec` | Deprecated: the first of `charts`, for UIs that draw one chart |
| `sources` | Which data source answered and with which SQL |
| `suggestedQuestions` | Genie's own follow-ups (when it gives any) |
| `traceId` | Reference for this request |

## POST {prefix}/feedback

Rate an answer (passed on to Genie): `{ "spaceId", "conversationId", "messageId", "rating": "POSITIVE" | "NEGATIVE" }`, with the ids from `final.result.sources`. Answer: `{ "ok": true }`.

## GET {prefix}/version, /health/live, /health/ready

`version` gives `{ service, contract, build }`. `live` answers while the process runs. `ready` answers `200` while the service takes questions and `503` while it shuts down. Neither health check calls Databricks.

## Errors and limits

Every error body is JSON with an `error` message that can be shown to the user.

| Status | When | Extra fields |
|---|---|---|
| `400` | The body does not match the schema | `issues` |
| `401` | No valid identity | `relogin: true` |
| `413` | The body is larger than `BI_MAX_BODY_BYTES` (16 KB) | |
| `429` | The user has `BI_MAX_CONCURRENT_PER_USER` (2) questions running, or the instance `BI_MAX_CONCURRENT_TOTAL` | `reason`, header `Retry-After` |
| `500` | A bug | `traceId` |
| `502` | Genie refused (feedback) | `traceId` |
| `503` | Switched off (`BI_ENABLED=false`) or restarting | `reason`, header `Retry-After` |

A question that runs longer than `BI_TURN_TIMEOUT_MS` (5 minutes) is stopped, and the stream ends with an `error` event saying so.

## Tracing

Every response carries `X-Trace-Id`. A caller may send a W3C `traceparent` (or `X-Trace-Id`) header; the service then uses the same trace id, so its log lines join the caller's trace. To report a problem, quote the trace id (also in `final.result.traceId` and in error messages).

## Versioning

`contract` in `GET {prefix}/version` and in the schema files follows semantic versioning: adding a field or an event type raises the minor version; removing or renaming one raises the major version. Clients should ignore fields and event types they do not know.
