# 13. How to contribute

## What you will learn
- What the repo says about branches and pull requests (very little).
- The coding habits to follow.
- What tests to expect.
- A checklist for a pull request.
- Two step-by-step recipes.

## Branches and pull requests

I cannot tell you. The repo has no `.git` folder, no pull request template, no `CODEOWNERS` file and no contributing guide. Ask your team lead for the branch naming, review and merge rules. This is recorded in [99-open-questions.md](99-open-questions.md).

## Coding habits seen in the code

- TypeScript with `strict` on (`server/tsconfig.json`, `ui/tsconfig.json`).
- Server files are ES modules (`"type": "module"`).
- Import types with `import type`.
- Comments explain why, and sit above the code they explain.
- Small functions, few files, no classes unless needed (the clients and token providers are classes).
- Messages shown to users are plain and short. Example: "Your session has expired. Please log in again." (`server/src/auth/sessions.ts`).
- No secrets in the browser code (`README.md`).
- No lint or format tool is configured. Match the file you are editing: single quotes, semicolons, two spaces.

## Tests you should expect to add

- Pure logic (chart building, parsing, token handling): add a test beside the file, named `*.test.ts`, using `vitest` (`server/package.json`).
- Code that calls Databricks: pass a fake `fetch` into the client, like `server/src/genie/client.test.ts` does.
- Routes, tools, agents and UI: there are no test examples. If you add the first one, say so in your pull request.

## Pull request checklist

- [ ] `npm run typecheck` passes in `server/` and in `ui/`.
- [ ] `npm test` passes in `server/`.
- [ ] `npm run build` at the root works.
- [ ] If you changed `server/src/contracts.ts`, you changed `ui/src/types.ts` to match.
- [ ] If you added a setting, it is in `server/.env.example`, and the docs say what it does.
- [ ] No secrets, tokens, real hostnames or real ids in the code or the docs.
- [ ] If you changed agent instructions, you tried at least one real question end to end.
- [ ] If you changed `README.md` behaviour, you updated it.

## Recipe 1: add an API endpoint

Example: `POST /bi/ping` that returns who you are.

1. Open `server/src/mastra/index.ts`.
2. Add a route next to `feedbackRoute`, copying its pattern:
   ```ts
   const pingRoute = registerApiRoute('/bi/ping', {
     method: 'POST',
     handler: async (c) => {
       const who = await authenticate(c);
       if (who instanceof Response) return who;
       return c.json({ user: who.user });
     },
   });
   ```
3. Add `pingRoute` to the `apiRoutes` list in the `mastra` object at the bottom.
4. Keep the path under `/bi/`. `serveUi` skips that prefix.
5. If the browser needs it, add a function in `ui/src/api.ts`, copying `sendFeedback`.
6. Run `npm run typecheck` in `server/` and `ui/`.
7. Rebuild, start, and try it:
   ```
   npm run build
   npm start
   ```
8. Test it in dev mode by calling it from the browser app, or with a tool like curl. In OAuth mode you need the session cookie.

This is a real pattern, taken from `feedbackRoute` in `server/src/mastra/index.ts`. The `/bi/ping` route is an example, not code in the repo.

## Recipe 2: add a UI element to an answer

Example: show how many sources an answer used.

1. Open `ui/src/components.tsx`.
2. Add a small component:
   ```tsx
   function SourceCount({ n }: { n: number }) {
     return <p className="q">Based on {n} Genie {n === 1 ? 'query' : 'queries'}.</p>;
   }
   ```
3. Use it inside `Details`, for example above the SQL blocks:
   ```tsx
   {result.sources.length > 0 && <SourceCount n={result.sources.length} />}
   ```
4. `result.sources` already exists on `FinalAnswer`, so no server change is needed. If you need a new field, follow [07-frontend.md](07-frontend.md).
5. Run `npm run typecheck` and `npm run build` in `ui/`.
6. Run the app and ask a question to see it.

The `q` class is real (used in `Details`). The component is an example, not code in the repo.

## Other recipes in these docs

- Add a Genie space: [06a-agents-and-tools.md](06a-agents-and-tools.md).
- Switch or add a chart type: [07a-charts.md](07a-charts.md).
- Add a setting: add it to `server/.env.example`, read it with `process.env.NAME ?? default`, and list it in [10-config-and-secrets.md](10-config-and-secrets.md).

## Key takeaways
- Branch and PR rules are not in the repo. Ask.
- Follow the style of the file you edit. No lint tool exists.
- Always keep `contracts.ts` and `types.ts` in step.
- Tests beside the code, with a fake `fetch` for Databricks calls.

## Where to look in the code
- `server/src/mastra/index.ts`: `feedbackRoute` as the route pattern.
- `ui/src/api.ts`: `sendFeedback` as the browser call pattern.
- `ui/src/components.tsx`: `Details`.
- `server/src/genie/client.test.ts`: the test pattern with a fake `fetch`.
