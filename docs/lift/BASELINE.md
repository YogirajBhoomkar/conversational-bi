# Baseline before the restructuring

Recorded on 4 November 2026 at commit `50e54f2`, before any change from the lift plan. Node v26.13.0 on Windows 11.

| Step (in `server/`) | Result |
|---|---|
| `npm install` | OK, lock file unchanged. npm warns that the `esbuild` install script was not run (npm's install-scripts approval); the build still works. |
| `npm run typecheck` | Clean, no errors. |
| `npm test` | 8 files, 63 tests, all pass. Expected warnings appear on stderr from tests that exercise retries and failures (`[retry] ...`, `[suggest] failed: boom`). |
| `npx mastra build` | Succeeds in about 3.5 minutes. Output in `.mastra/output`. Mastra prints the start command: `node .mastra/output/index.mjs`. |

`@mastra/core` 1.79.0 declares `"engines": { "node": ">=22.13.0" }`.

## Characterization tests added

`server/src/characterization/chatRoute.test.ts`: 9 tests that call the real `/bi/chat` and `/bi/feedback` handlers with a faked supervisor, suggest agent and storage (no network, no model, no Genie, and `server/.env` is never read). They pin:

- the exact `ChatEvent` sequence of a full turn: model meta, working note, tool entry running, Genie progress, tool entry done, answer text, `final`, `suggestions`;
- `suggestions` arriving before `final` when they are ready first;
- the stream closing after `SUGGEST_WAIT_MS` when our follow-ups are slow, and not waiting at all when Genie sent its own;
- a failed turn ending with an `error` event and no `final`;
- threads per user (`<user>::<threadId>` as the memory thread and request-context thread);
- 400 responses for bad chat and feedback bodies, naming the field, and for an unknown space.

After this: 9 files, 72 tests, all pass.
