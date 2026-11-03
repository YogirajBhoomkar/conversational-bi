# 06. Backend (HTTP side)

## What you will learn
- Which routes the server offers.
- How the live stream is built.
- How the server checks who you are, and how it handles errors.
- How the server serves the browser app.
- How to add a new route.

This doc covers the web side. The AI side is in [06a-agents-and-tools.md](06a-agents-and-tools.md).

## No controllers, guards or interceptors

This server is not built like a typical layered web framework. There are no controller classes, guards or interceptors. Everything is in one file, `server/src/mastra/index.ts`. Routes are plain functions registered with `registerApiRoute` from Mastra.

## The routes

| Method and path | What it does | Code |
|---|---|---|
| `POST /bi/chat` | Runs the supervisor and streams events back | `chatRoute` |
| `POST /bi/feedback` | Sends a thumbs up or down to Genie | `feedbackRoute` |
| `GET /auth/me` | Says whether you are signed in | `authRoutes` |
| `GET /auth/login` | Redirects to Databricks sign-in (or to `/` if OAuth is off) | `authRoutes` |
| `GET /auth/callback` | Finishes sign-in, sets the cookie | `authRoutes` |
| `POST /auth/logout` | Deletes the session and the cookie | `authRoutes` |
| `GET /*` | Serves the built browser app when `UI_DIST` is set | `serveUi` |

All in `server/src/mastra/index.ts`. Mastra also adds its own routes, such as Studio in development.

## Checking who you are

`authenticate` is a small function called at the top of the chat and feedback routes. It is the nearest thing to a guard.

```ts
async function authenticate(c: any): Promise<{ sessionId?: string; user: string } | Response> {
  if (!oauth) return { user: 'dev' };
  const sessionId = readSessionId(c.req.header('cookie'));
  const session = getSession(sessionId);
  if (!sessionId || !session) return c.json({ error: 'Please log in.', relogin: true }, 401);
```

Notice it returns either the caller or a ready-made 401 `Response`. The route checks `who instanceof Response` and returns it. See [08-auth-and-access.md](08-auth-and-access.md).

## How the stream is built

The chat route makes a `ReadableStream`. Inside it, `send` writes one SSE message. An SSE message is the text `data: <json>` followed by a blank line.

```ts
const sse = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;
```

The response headers are `Content-Type: text/event-stream` and `Cache-Control: no-cache`. The route then loops over `stream.fullStream` from Mastra and turns chunks into events:

| Mastra chunk | Event sent |
|---|---|
| `text-delta` | `text` |
| Text before a tool call or handover | a `trace` note (the agent's working note) |
| `tool-call-input-streaming-start`, `tool-call`, `tool-result` | a `trace` entry for the handover or tool call (running, then done or error) |
| Nested chunks from the data agent (inside `tool-output`) | its own notes and its Ask Genie entry |
| `error` | throws, which becomes an `error` event |

`server/src/mastra/trace.ts` does this translation. The text of a step that calls a tool is a working note; the text of a step that calls none is the final answer and becomes `text` events. Genie's own progress comes from the tool through `collector.emit` and is shown under the Ask Genie entry that is running.

The route sends `final` as soon as the answer is ready. Follow-ups are started when the request arrives and run in parallel, so the route never waits for them before `final`. It sends `suggestions` whenever they are ready, then waits at most `SUGGEST_WAIT_MS` (default 8000) after `final` before closing the stream in `finally`.

## Errors and validation

- **Bad input:** if `threadId` or `message` is missing or blank, the route answers 400 (`chatRoute`).
- **Not signed in:** 401 with `relogin: true`.
- **Feedback with an unknown space:** 400 `unknown space`. If Genie fails: 502 with the message (`feedbackRoute`).
- **Anything thrown inside the stream:** caught, sent as an `error` event, then the stream closes. The HTTP status is already 200 by then.
- **Not checked in the route code:** the shape of the request body beyond those fields. The `rating` value in feedback is passed on without checking. A body that is not valid JSON would throw before the `try` block. I did not find code that handles that.

The data shapes have zod schemas in `server/src/contracts.ts`, but the routes do not call `.parse` on the request. They only use TypeScript types.

## Serving the browser app

`serveUi` is middleware on `/*`. It does the following (`server/src/mastra/index.ts`):

- Does nothing unless `UI_DIST` is set and the request is a `GET`.
- Skips paths that start with `/api`, `/bi`, `/auth/` or `/swagger`.
- Reads the file from the build folder. It blocks paths that climb out with `..`.
- Falls back to `index.html`, so a page reload on any path still works.

## CORS

The `Mastra` config allows only `http://localhost:5173`, with methods `GET`, `POST`, `OPTIONS` (`server/src/mastra/index.ts`, `server.cors`). In production the UI comes from the same origin, so CORS is not needed.

## How to add a new route

1. Open `server/src/mastra/index.ts`.
2. Copy the shape of `feedbackRoute`:
   ```ts
   const myRoute = registerApiRoute('/bi/my-thing', {
     method: 'POST',
     handler: async (c) => {
       const who = await authenticate(c);
       if (who instanceof Response) return who;
       // read c.req.json(), do the work, return c.json({ ok: true })
     },
   });
   ```
3. Add it to the `apiRoutes` list at the bottom of the file.
4. Keep the path under `/bi/` or `/auth/`. `serveUi` skips those prefixes. A path outside them would be treated as a file request.
5. If the browser calls it, add a function in `ui/src/api.ts`. If the data has a new shape, add it to `server/src/contracts.ts` and `ui/src/types.ts`.
6. Run `npm run typecheck` in `server/`. Then rebuild, since `npm start` runs the built copy.

A fuller recipe is in [13-how-to-contribute.md](13-how-to-contribute.md).

## Key takeaways
- All routes live in one file: `server/src/mastra/index.ts`.
- `authenticate` is the guard. Call it first in every private route.
- The chat route streams SSE events. Errors in the stream become `error` events.
- Request bodies are only lightly checked.
- Keep new paths under `/bi/` or `/auth/`.

## Where to look in the code
- `server/src/mastra/index.ts`: `authenticate`, `chatRoute`, `feedbackRoute`, `authRoutes`, `serveUi`, `mastra`.
- `server/src/contracts.ts`: `ChatEvent`, `ChatRequest`, `FeedbackRequest`.
- `ui/src/api.ts`: the matching browser calls.
