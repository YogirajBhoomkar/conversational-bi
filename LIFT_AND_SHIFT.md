# Lift and shift into GC's monorepo

For the GC engineer who brings Conversational BI into `gc-bridge-v2`. It takes the server code as a self-contained Nx app, hosts it behind GC's existing Okta guard and Databricks token service, and embeds the chat page in GC's UI.

## 1. Copy the code

From this repository:

```bash
node scripts/lift.mjs --target <path to gc-bridge-v2>            # dry run: lists every file it would copy
node scripts/lift.mjs --target <path to gc-bridge-v2> --apply    # copies
```

The files go to `apps/conversational-bi` (change with `--app`). The script refuses to run if the target has uncommitted changes or if any file already exists, so nothing of GC's is overwritten. It never commits; review the result with `git status` in GC's repository. What it copies is listed in `lift/LIFT_MANIFEST.txt`. It never copies `.env` files, local databases or `node_modules`.

## 2. Dependencies and Node

The core runs on Mastra, which needs **Node 22.13 or later**. `lift/deps.manifest.json` lists what it needs and why. GC's API runs Node 20 today, so the app runs on its own Node 22 runtime: either as its own NestJS app or with the Mastra server it has. Check `zod` against GC's version before merging dependencies into one root `package.json` (we use zod 4).

The Mastra versions are GC's to choose: the lifted `package.json` shows the ones tested here, but GC's lockfile decides. Install one Mastra release set, with `@mastra/deployer` and `@mastra/server` pinned to `@mastra/core`'s version, and check it with `node scripts/compat-check.mjs --profile <file>` before merging. `lift/deps.manifest.json` (`mastra`) lists the packages that move together, and `docs/lift/MASTRA-COMPAT.md` has the findings for the older 1.32 set.

## 3. Host it

Use GC's NestJS conventions and GC's own auth, as is:

1. Create the NestJS app (or reuse one on Node 22) and copy the two templates from `apps/conversational-bi/src/edge/templates/nest/` into it (`bi.module.ts`, `bi.controller.ts`).
2. Resolve every `TODO(GC:...)` in them: the path to GC's Okta guard and its user type, GC's Databricks token service and its method, the import paths, the route prefix.
3. Add `BiModule` to the app's `AppModule`, and set the JSON body limit to `BI_MAX_BODY_BYTES`.

The templates use the same core pieces as our own server (limits, shutdown, trace ids, logging, error rules), so the HTTP contract (`docs/CONTRACT.md`) is the same.

## 4. Configure

Set the settings in `docs/lift/GC-CONFIG.md` per environment: Helm values for plain settings, Vault for keys, a ConfigMap for the spaces file and domain rules. The service stops at start with one clear message if a setting is missing or wrong.

## 5. Embed the page in GC's UI

GC's UI shows the chat page and calls `POST <prefix>/chat` with the user's Okta bearer token. The events and the answer format are in `docs/CONTRACT.md`. The page itself (React) moves separately; see the report.

## 6. Check

```bash
npx nx run conversational-bi:typecheck
npx nx run conversational-bi:test
npx nx run conversational-bi:build
```

Then, in a dev environment: `GET <prefix>/version` answers, `GET /health/ready` is `200`, and a question streams back with a trace id. Logs are JSON with `traceId` (`docs/lift/DATADOG.md`).

Open questions for GC are in `docs/lift/OPEN-QUESTIONS.md`; the overall state is in `docs/lift/REPORT.md`.
