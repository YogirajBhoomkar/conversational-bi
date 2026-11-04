// Manual check against a real Genie space (needs credentials in server/.env): npx tsx scripts/smoke-genie.ts "<question>"
import 'dotenv/config';
import { PatTokenProvider } from '../src/auth/tokenProvider';
import { loadProcessConfig } from '../src/config/load';
import { DatabricksGenieClient } from '../src/genie/client';
import { retryPolicy } from '../src/genie/retry';

const { config } = loadProcessConfig();
const c = new DatabricksGenieClient(new PatTokenProvider(config.databricks.token), {
  host: config.databricks.host,
  rowCap: config.genie.rowCap,
  timeoutMs: config.genie.timeoutMs,
  retry: retryPolicy(config.genie.retryAttempts),
});
const sp = config.spaces[0].spaceId;
const r1 = await c.ask({ spaceId: sp, question: process.argv[2] ?? 'What tables or metrics are available? Give a brief overview.' });
console.log(JSON.stringify({ ...r1, rows: r1.rows.slice(0, 5) }, null, 2));
if (!r1.error) {
  const r2 = await c.ask({ spaceId: sp, question: 'Summarize that in one line', conversationId: r1.conversationId });
  console.log('FOLLOWUP same conv:', r2.conversationId === r1.conversationId, '|', r2.summary.slice(0, 200), r2.error);
}
