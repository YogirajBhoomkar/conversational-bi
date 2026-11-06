# 15. Glossary

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- Plain-English meanings of every term and acronym used in these docs.

Terms are in alphabetical order.

| Term | Meaning |
|---|---|
| **Access token** | A short-lived pass that proves who you are to Databricks. Held in server memory (`server/src/adapters/local/auth/sessions.ts`) |
| **Agent** | An AI model plus instructions plus tools. Defined with `new Agent({...})` (`server/src/core/agents/prompts.ts`) |
| **API** | A way for programs to talk to each other over HTTP |
| **Authorization code** | A one-time code Databricks gives the browser after sign-in. The server swaps it for tokens |
| **Bundle** | The single packed file a build tool makes from many source files |
| **Chart spec** | The app's neutral description of a chart: type, axes, data. Drawn in the browser by one library (`server/src/contracts.ts`) |
| **`chart_json`** | The name of the one-cell result Genie returns for a chart request. It holds JSON (`server/src/core/chart/chartSpec.ts`) |
| **Collector** | A per-request object that tools fill with rows, SQL and chart so the route can send them to the browser (`server/src/core/chat/collector.ts`) |
| **Conversation API** | The default Genie API: start a conversation, then poll until done (`server/src/core/genie/client.ts`) |
| **Cookie, `HttpOnly`** | A small value the browser stores and sends back. `HttpOnly` means page scripts cannot read it. Here: `bi_sid` |
| **CORS** | A browser rule about which web addresses may call a server. Fixed to the dev UI address here |
| **D3** | A chart-drawing library. One of three options (`ui/src/charts/D3Chart.tsx`) |
| **dotenv** | A library that loads settings from a `.env` file |
| **`.env`** | A local file of settings and secrets. Never committed |
| **Event (SSE)** | One message on the live stream, for example `text` or `final` (`ChatEvent` in `server/src/contracts.ts`) |
| **FOT** | A term from the business domain. In the code it is both a placement status (between "Provide Quote" and "Authorization") and the name of a premium measure, "FOT premium". The repo does not spell the acronym out. Ask a domain expert |
| **Genie** | A Databricks feature that turns English questions into SQL and returns rows |
| **Genie Agent mode** | A newer Genie API (GA since Aug 2026) that streams its reasoning (`GENIE_MODE=agent`) |
| **Genie space** | One Genie set up for one group of tables. The app lists its spaces in `server/src/core/genie/registry.ts` |
| **Layer** | A slice of a reinsurance placement. A data term used in agent text ("layer count") |
| **LibSQL** | A SQLite-based database engine. Mastra uses it for storage files |
| **LLM** | Large language model: the AI behind the agents. Claude by default |
| **Mastra** | A Node library for building AI agents and their HTTP server (`server/package.json`) |
| **Mastra Studio** | Mastra's built-in test page in dev mode, at the server address |
| **Memory** | What the supervisor remembers about a chat. Stored in `bi-memory.db` |
| **Mermaid** | A text format for diagrams, used in these docs |
| **Message thread (thread id)** | An id for one chat. The server prefixes it with the user name |
| **OAuth** | A standard way to sign in through another service |
| **PAT** | Personal access token: a password-like string from Databricks. Used for dev mode |
| **PKCE** | An extra OAuth safety step for apps that cannot keep a secret |
| **Placement** | A reinsurance deal being arranged. The main subject of the data |
| **Plotly** | A chart-drawing library. One of three options |
| **Public client** | An OAuth app that has no client secret. This app is one |
| **React** | A library for building web pages out of components |
| **Recharts** | A chart library built for React. The default option |
| **Refresh token** | A longer-lived token used to get a new access token without signing in again |
| **Reinsurer** | A company that takes on part of an insurer's risk |
| **`RequestContext`** | A bag of values that travels with one request inside Mastra. Carries the collector and thread id |
| **Route** | A server address that does something, for example `/bi/chat` |
| **Scope** | A permission asked for during sign-in. Here: `all-apis offline_access` |
| **Session** | The server's record of a signed-in user, found by the `bi_sid` cookie |
| **SCIM** | A Databricks API used here only to read the user's name |
| **SPA** | Single-page app: one HTML page whose content changes in the browser. `serveUi` falls back to `index.html` for this |
| **SQL** | The language for asking questions of a database |
| **SQL Statement API** | A Databricks API to fetch results of a SQL statement. Used to load more rows |
| **SQLite** | A database that lives in one file |
| **SSE (Server-Sent Events)** | One long HTTP response that sends many messages over time |
| **Sub-agent / specialist** | An agent the supervisor can hand work to. Here: one per Genie space |
| **Supervisor** | The top agent that routes questions and writes the final answer (`bi_supervisor`) |
| **Tool** | A function an agent may call. Here: `ask-<key>` and `fetch-full-<key>` |
| **Underwriting year** | The year a policy or placement was written. "Year" in questions means this (supervisor `instructions`) |
| **Unity Catalog** | Databricks' system for deciding who may read which data |
| **Vite** | The tool that serves and builds the browser app |
| **vitest** | The test runner used on the server |
| **zod** | A library that describes data shapes and checks them |

## Key takeaways
- Most terms fall into four groups: AI (agent, tool, supervisor), Databricks (Genie, space, token), web (SSE, route, cookie), and domain (FOT, placement, reinsurer).
- When a domain term is unclear, ask a domain expert. The code does not define them.
- Add new terms here when you meet them.

## Where to look in the code
- `server/src/contracts.ts`: shape names.
- `server/src/core/agents/prompts.ts`: domain wording in the agent text.
- `server/src/core/genie/registry.ts`: space descriptions.
