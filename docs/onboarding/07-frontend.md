# 07. Frontend

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- How the browser app is structured.
- How it reads the live stream.
- How the state works.
- How the styling is organised.
- How to add a new piece to the screen.

## The shape of the app

The browser app is small: one page, no router, no state library, no component library. It uses React 19 with plain `useState` (`ui/src/App.tsx`, `ui/package.json`).

| File | Role |
|---|---|
| `ui/src/main.tsx` | Mounts `<App />` inside `StrictMode` and loads `styles.css` |
| `ui/src/App.tsx` | `App` (checks sign-in), `LoginPage`, `Chat` (the main screen) |
| `ui/src/components.tsx` | `DataTable`, `Feedback`, `Scratchpad`, `Details`, `ChartBoundary` |
| `ui/src/api.ts` | `getMe`, `logout`, `streamChat`, `sendFeedback` |
| `ui/src/types.ts` | Types for events, answers, chart spec, messages |
| `ui/src/charts/` | Chart renderers. See [07a-charts.md](07a-charts.md) |
| `ui/src/styles.css` | All CSS, about 80 lines |

## Which screen shows

`App` calls `getMe()` once. Then:

- Still loading: "Loading…".
- Not signed in: `LoginPage` with a link to `/auth/login`.
- Signed in: `Chat`.

In shared-token mode `/auth/me` always says you are signed in, so you go straight to `Chat` (`server/src/mastra/index.ts`, `/auth/me`).

## State

All state lives in `Chat` (`ui/src/App.tsx`):

| State | Meaning |
|---|---|
| `threadId` | Id of the current chat. Saved in `localStorage` as `bi-thread` |
| `messages` | The list of user and assistant messages |
| `input` | The text box |
| `busy` | True while a question is running. Disables the input |

The `Message` type has two shapes: user (`text`), and assistant (`text`, `trace`, `startedAt`, `endedAt`, `result`, `error`, `pending`) (`ui/src/types.ts`).

"New chat" clears the messages and makes a new thread id.

## Reading the stream

`streamChat` in `ui/src/api.ts` sends the request, then reads the body as text. It splits the text on blank lines. For each block it joins the `data:` lines and parses JSON.

```ts
const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
if (data) onEvent(JSON.parse(data) as ChatEvent);
```

Notice it uses `fetch` and a stream reader, not the browser's `EventSource`. `EventSource` cannot send a POST body.

`Chat.send` handles each event by updating the last assistant message with `patchLast`. See the table in [05-request-journey.md](05-request-journey.md).

If the server answers 401, `streamChat` throws `ReloginError` and `Chat` calls `onLoggedOut`, which shows the login page again.

## What an answer shows

`Details` in `ui/src/components.tsx` draws, in order:

1. The chart (inside `ChartBoundary`), with its title.
2. A collapsed table, with a note if only a preview of the rows is shown. Click a column header to sort.
3. One collapsed SQL block per source, with Helpful and Not helpful buttons.
4. Suggested follow-up questions as buttons. Clicking one sends it as a new question.

`ChartBoundary` is a small class component. If a chart throws while drawing, it hides the chart and logs the error. The rest of the page stays alive. It must be a class, because React only supports error boundaries as classes.

## Styling

- One CSS file, plain CSS with variables at the top (`ui/src/styles.css`).
- The first comment says it follows the "Xoriant UI standard": green for call-to-action buttons only, League Spartan for headings, Mona Sans for body text, Poppins for buttons.
- Fonts load from Google Fonts in `ui/index.html`. See [14-gotchas.md](14-gotchas.md).
- The sidebar shows the text "Xoriant" (`ui/src/App.tsx`), not a logo file (`README.md`, "Known limits").

## How to add a new piece to the answer

Example: show a new field of the answer under the chart.

1. If the server must send new data, add it to `FinalAnswer` in `server/src/contracts.ts`, fill it in `chatRoute`, and add the same field to `FinalAnswer` in `ui/src/types.ts`.
2. Write a small component in `ui/src/components.tsx`.
3. Use it inside `Details`.
4. Add a few lines of CSS in `ui/src/styles.css`.
5. Run `npm run typecheck` and `npm run build` in `ui/`.
6. Rebuild the server too, if you changed `contracts.ts`.

There are no pages or routes to add. If you need a second page, you would first have to add a router. That choice has not been made in this repo.

## Key takeaways
- One page, plain `useState`, no router.
- The stream is read with `fetch`, split on blank lines, parsed as JSON.
- `ChartBoundary` keeps a chart failure from blanking the app.
- `ui/src/types.ts` is a hand-kept copy of server shapes.

## Where to look in the code
- `ui/src/App.tsx`: `Chat`, `send`, `patchLast`.
- `ui/src/api.ts`: `streamChat`.
- `ui/src/components.tsx`: `Details`, `DataTable`, `ChartBoundary`.
- `ui/src/types.ts`: all UI types.
- `ui/src/styles.css`: styling.
