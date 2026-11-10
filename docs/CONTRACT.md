# Conversational BI API contract (1.4.0)

For the engineers who embed the chat page in GC's UI or host the service. The machine-readable versions are generated from the code and cannot drift from it: `server/contracts/*.schema.json` (one JSON Schema per message) and `server/contracts/bi.openapi.yaml`. Regenerate with `npm run contracts`; a test fails when they are out of date.

The prefix is `BI_ROUTE_PREFIX` (default `/bi`).

## Identity

The host identifies the caller. In GC that is GC's Okta guard: send the user's Okta access token as `Authorization: Bearer <token>`. Locally it is a Databricks login cookie, or a shared development token. Without a valid identity the answer is `401` with `relogin: true`, and the UI should send the user to sign in again.

## POST {prefix}/chat

Ask a question. The answer streams back as Server-Sent Events.

Request (`chat-request.schema.json`):

```json
{
  "threadId": "a-uuid-per-conversation",
  "message": "And by region?",
  "history": [
    { "question": "How much limit was placed in 2024?", "answer": "**1,737.2M** of limit was placed in 2024.", "space": "Placement" }
  ]
}
```

`threadId` names the conversation: send the same one for follow-up questions, and a new one for a new chat. Threads belong to the user who started them.

`history` (optional, added in 1.2.0) is the chat so far, oldest first: each earlier `question` with its `answer` (the `final.result.answer` text), and optionally the `space` name and `sql` of the first source. The service keeps no transcript of its own, so a follow-up such as "and by region?" works only when the earlier turns are sent; any instance can then answer it, after a restart too. At most 10 turns (400 above it); `question` up to 4000 characters, `answer` and `sql` up to 20000, `space` up to 100. The service uses only the latest `BI_HISTORY_TURNS` (default 6), cuts each question and answer to `BI_HISTORY_MAX_CHARS` (default 1500), and ignores `sql` unless `BI_HISTORY_INCLUDE_SQL=true`. Leave out unfinished and failed turns. The text is treated as context, never as instructions. A request without `history` is answered as a new question.

Response: `200`, `Content-Type: text/event-stream`. Each `data:` line holds one event as JSON (`chat-event.schema.json`). Lines starting with `:` are keep-alive comments and can be ignored.

| Event | Fields | Meaning |
|---|---|---|
| `trace` | `item` | One entry of the scratchpad (what the assistant is doing). An `item.id` sent again updates that entry. See below |
| `text` | `delta` | The next piece of the answer (Markdown). Append it |
| `text-reset` | | The text streamed so far was a working step after all: clear the answer |
| `final` | `result` | The complete answer (below). Sent once |
| `suggestions` | `questions` | Up to 3 follow-up questions. Can come before or after `final` |
| `error` | `message`, and since 1.3.0 `kind`, `title`, `detail`, `retryable`, `reference` | The turn failed. `message` can be shown as is; it includes a reference (except for a timeout or a refusal). For a friendlier notice show `title` and `detail`, offer to ask again when `retryable`, and show `reference` (the trace id) to quote. `kind` is `unavailable` (the AI service could not be reached), `busy` (rate limited), `source` (every data source failed, for example no network; asking again may help), `limit` (a Databricks budget or quota is used up; asking again does not help until an admin raises it), `timeout`, `failed` or `refused` |

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
| `clarification` | Present when the question was ambiguous: `question` and 2 to 4 `options`. Show the options as choices plus a last "something else" choice with a text box; send the chosen or typed text as the next message in the same thread |
| `traceId` | Reference for this request |

## POST {prefix}/feedback

Rate an answer (passed on to Genie): `{ "spaceId", "conversationId", "messageId", "rating": "POSITIVE" | "NEGATIVE" }`, with the ids from `final.result.sources`. Answer: `{ "ok": true }`.

## GET {prefix}/client-config (Proposed, 1.4.0)

Settings the UI needs, for the signed-in caller: `{ feedback: { to, content, format, maxUrlChars }, userRef, build, contract }`. `feedback.to` is the list of addresses from `BI_FEEDBACK_EMAIL`, or `null` (then the UI shows no Send feedback button). `userRef` is the caller's short one-way hash, the same value the logs carry as `user`; the response never holds the user id, an email address or a token. 401 without a valid identity. Schema: `client-config.schema.json`.

## POST {prefix}/feedback/opened (Proposed, 1.4.0)

The UI tells the service that a feedback email was opened, so feedback can be counted by type even when the email is never sent. Body (strict; any other field is a 400): `{ traceId, turn, format: "text" | "eml", reason: "wrong_numbers" | "wrong_source" | "chart_or_table" | "too_slow" | "should_refuse" | "other" | null }`, at most 1 KB (413 above it). The service logs `feedback.opened` on the trace of that turn, with only these fields, and answers 204. The comment, question and answer never come here. Schema: `feedback-opened.schema.json`.

## GET {prefix}/.well-known/agent-card.json (1.4.0)

What this assistant can do, for a catalogue or another agent, shaped like an A2A agent card: `name`, `description`, `url` (the chat route; not an A2A JSON-RPC endpoint), `version` (the build), `contract`, `capabilities` (`streaming`, and `extensions`), the input and output modes, and `skills`, one per data area (its key, name, the first sentence of its description and its configured `examples`). The extension `urn:conversational-bi:feedback-email` carries the Send feedback setup: `enabled`, `to`, `format`, `content` and, for `text`, `maxUrlChars`. Built from configuration only: never the system prompt, agent or tool names, space ids or the model. Signed-in callers only (401 otherwise). Mastra's own agent cards under `/api` are closed. Schema: `agent-card.schema.json`.

## GET {prefix}/version, /health/live, /health/ready

`version` gives `{ service, contract, build }`. `live` answers while the process runs. `ready` answers `200` while the service takes questions and `503` while it shuts down. Neither health check calls Databricks.

## Errors and limits

Every error body is JSON with an `error` message that can be shown to the user.

| Status | When | Extra fields |
|---|---|---|
| `400` | The body does not match the schema | `issues` |
| `401` | No valid identity | `relogin: true` |
| `413` | The body is larger than `BI_MAX_BODY_BYTES` (64 KB) | |
| `429` | The user has `BI_MAX_CONCURRENT_PER_USER` (2) questions running, or the instance `BI_MAX_CONCURRENT_TOTAL` | `reason`, header `Retry-After` |
| `500` | A bug | `traceId` |
| `502` | Genie refused (feedback) | `traceId` |
| `503` | Switched off (`BI_ENABLED=false`) or restarting | `reason`, header `Retry-After` |

A question that runs longer than `BI_TURN_TIMEOUT_MS` (5 minutes) is stopped, and the stream ends with an `error` event saying so.

## Tracing

Every response carries `X-Trace-Id`. A caller may send a W3C `traceparent` (or `X-Trace-Id`) header; the service then uses the same trace id, so its log lines join the caller's trace. To report a problem, quote the trace id (also in `final.result.traceId` and in error messages).

## Versioning

`contract` in `GET {prefix}/version` and in the schema files follows semantic versioning: adding a field or an event type raises the minor version; removing or renaming one raises the major version. Clients should ignore fields and event types they do not know.

| Version | Change |
|---|---|
| 1.4.0 | `GET .well-known/agent-card.json`; Proposed: `GET client-config` and `POST feedback/opened`, for the Send feedback email |
| 1.3.0 | `kind`, `title`, `detail`, `retryable` and `reference` on the `error` event |
| 1.2.0 | `history` on the chat request; the service no longer remembers the chat itself |
| 1.1.0 | `charts` and `clarification` on the final answer |
