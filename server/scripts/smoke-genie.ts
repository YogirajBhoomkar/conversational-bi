import 'dotenv/config';
import { DatabricksGenieClient } from '../src/genie/client';
import { PatTokenProvider } from '../src/auth/tokenProvider';
import { genieSpaces } from '../src/genie/registry';

const c = new DatabricksGenieClient(new PatTokenProvider());
const sp = genieSpaces[0].spaceId;
const r1 = await c.ask({ spaceId: sp, question: process.argv[2] ?? 'What tables or metrics are available? Give a brief overview.' });
console.log(JSON.stringify({ ...r1, rows: r1.rows.slice(0, 5) }, null, 2));
if (!r1.error) {
  const r2 = await c.ask({ spaceId: sp, question: 'Summarize that in one line', conversationId: r1.conversationId });
  console.log('FOLLOWUP same conv:', r2.conversationId === r1.conversationId, '|', r2.summary.slice(0, 200), r2.error);
}
