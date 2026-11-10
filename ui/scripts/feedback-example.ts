// Writes docs/lift/feedback-example/ from a made-up turn: the email body and the mailto link, exactly as the Send
// feedback button builds them. Run from ui/: npx tsx scripts/feedback-example.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFeedbackMailto } from '../src/feedback/mailto';
import type { FeedbackInput } from '../src/feedback/types';

const example: FeedbackInput = {
  to: ['feedback@example.invalid'],
  reason: 'wrong_numbers',
  comment: 'The 2024 total looks higher than our monthly report.',
  question: 'What was the total order value by year, and which year grew most?',
  answer: [
    'Order value grew every year, with the biggest rise in **2024** (**+10.2%**, to **42.0M**).',
    '',
    '| Year | Order value | Change |',
    '|---|---|---|',
    '| 2022 | 35.4M | - |',
    '| 2023 | 38.1M | +7.6% |',
    '| 2024 | 42.0M | +10.2% |',
    '',
    '*Order value is the sum of all confirmed orders in the year.*',
  ].join('\n'),
  content: 'full',
  traceId: '0f1e2d3c-4b5a-4968-8776-655443322110',
  userRef: 'a1b2c3d4e5f6',
  chatId: '6c1d2e3f-0a9b-4c8d-9e7f-123456789abc',
  turn: 2,
  time: '2026-11-10T14:05:00+05:30',
  build: 'example-build',
  contract: '1.4.0',
  genieIds: ['conv-made-up-1/msg-made-up-1'],
};

const dir = join(import.meta.dirname, '..', '..', 'docs', 'lift', 'feedback-example');
mkdirSync(dir, { recursive: true });
const mail = buildFeedbackMailto(example, 1900);
writeFileSync(join(dir, 'email-body.txt'), mail.body.replace(/\r\n/g, '\n') + '\n');
writeFileSync(join(dir, 'mailto-link.txt'), `${mail.url}\n\n(${mail.url.length} characters, budget 1900)\n`);
console.log(`Wrote ${dir}: mailto link ${mail.url.length} characters`);
