import { describe, expect, it } from 'vitest';
import type { TraceItem } from '../../contracts';
import { createSpaceRegistry } from '../genie/registry';
import { createTracer, crisp } from './trace';

const registry = createSpaceRegistry([
  { key: 'placement', name: 'Lab – Placement Core', description: 'Placement counts and premium.', spaceId: 's1' },
  { key: 'capacity', name: 'Lab – Capacity & Reinsurer', description: 'Reinsurer capacity.', spaceId: 's2' },
]);

// Chunk shapes captured from a real supervisor stream.
const top = (type: string, payload: object) => ({ type, payload });
const nested = (outerTool: string, type: string, payload: object, outer = 'outer') => ({ type: 'tool-output', payload: { toolName: outerTool, toolCallId: outer, output: { type, payload } } });
const finish = (reason: string) => ({ stepResult: { reason } });

const tracer = () => {
  const trace: TraceItem[] = [];
  let answer = '';
  const t = createTracer({ trace: (i) => trace.push(i), answer: (d) => (answer += d) }, registry);
  return { t, trace, answer: () => answer };
};
const run = (chunks: any[]) => {
  const { t, trace, answer } = tracer();
  chunks.forEach((c) => t.handle(c));
  t.end();
  return { trace, answer: answer() };
};

describe('createTracer', () => {
  it('shows the plan as a note and one entry per data source, named after the source, with its question', () => {
    const { trace, answer } = run([
      top('text-delta', { text: 'Comparing placed limit ' }),
      top('text-delta', { text: 'with signed capacity.' }),
      top('tool-call-input-streaming-start', { toolCallId: 'c1', toolName: 'agent-genie_placement' }),
      top('tool-call', { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt: 'Placed limit by region', maxSteps: 10 } }),
      top('tool-result', { toolCallId: 'c1', toolName: 'agent-genie_placement', result: { text: 'done' } }),
      top('step-finish', finish('tool-calls')),
    ]);
    expect(answer).toBe('');
    expect(trace[0]).toMatchObject({ kind: 'note', text: 'Comparing placed limit with signed capacity.' });
    expect(trace[1]).toMatchObject({ id: 'c1', kind: 'tool', label: 'Lab – Placement Core', status: 'running' });
    expect(trace[2]).toMatchObject({ id: 'c1', text: 'Placed limit by region' });
    expect(trace[3]).toMatchObject({ id: 'c1', status: 'done' });
  });

  it('treats the text of a step that calls no tool as the final answer', () => {
    const { trace, answer } = run([top('text-delta', { text: 'Hello. ' }), top('text-delta', { text: 'Ask me about placements.' }), top('step-finish', finish('stop'))]);
    expect(answer).toBe('Hello. Ask me about placements.');
    expect(trace).toEqual([]);
  });

  it("leaves out what repeats the source entry: the data agent's notes, its Ask Genie call and its closing report", () => {
    const { trace, answer } = run([
      nested('agent-genie_placement', 'text-delta', { text: 'I will count placements by status.' }),
      nested('agent-genie_placement', 'tool-call', { toolCallId: 'a1', toolName: 'ask-placement', args: { question: 'Count placements.' } }),
      nested('agent-genie_placement', 'tool-result', { toolCallId: 'a1', toolName: 'ask-placement', result: { summary: 's', error: null } }),
      nested('agent-genie_placement', 'step-finish', finish('tool-calls')),
      nested('agent-genie_placement', 'text-delta', { text: 'Internal report for the supervisor.' }),
      nested('agent-genie_placement', 'step-finish', finish('stop')),
    ]);
    expect(answer).toBe('');
    expect(trace).toEqual([]);
  });

  it("shows a Genie error under the source it belongs to", () => {
    const { trace } = run([nested('agent-genie_placement', 'tool-result', { toolCallId: 'a2', toolName: 'ask-placement', result: { error: 'Genie timed out' } }, 'h1')]);
    expect(trace[0]).toMatchObject({ kind: 'progress', parent: 'h1', status: 'error', text: 'Genie timed out' });
  });

  it('shows loading all rows as one line that turns done', () => {
    const { trace } = run([
      nested('agent-genie_placement', 'tool-call', { toolCallId: 'f1', toolName: 'fetch-full-placement' }, 'h1'),
      nested('agent-genie_placement', 'tool-result', { toolCallId: 'f1', toolName: 'fetch-full-placement', result: { ok: true } }, 'h1'),
    ]);
    expect(trace.map((i) => [i.id, i.text, i.status])).toEqual([['h1:f1', 'Loading all rows', 'running'], ['h1:f1', 'Loading all rows', 'done']]);
  });

  it("puts each source's thoughts and queries under that source, even when sources run at the same time", () => {
    const { t, trace } = tracer();
    t.handle(top('tool-call', { toolCallId: 'h1', toolName: 'agent-genie_placement', args: { prompt: 'q1' } }));
    t.handle(top('tool-call', { toolCallId: 'h2', toolName: 'agent-genie_capacity', args: { prompt: 'q2' } }));
    t.progress({ kind: 'thought', text: 'I will check which years exist. Then I will chart it.' }, 'placement');
    t.progress({ kind: 'query', id: 'm:1', title: 'Signed limit by region', status: 'running' }, 'capacity');
    t.progress({ kind: 'thought', text: 'I will check which years exist.' }, 'placement'); // the same thought again
    t.progress({ kind: 'query', id: 'm:1', status: 'done' }, 'capacity');
    const progress = trace.filter((i) => i.kind === 'progress');
    expect(progress.map((i) => [i.parent, i.step, i.text, i.status])).toEqual([
      ['h1', 'thought', 'I will check which years exist.', undefined],
      ['h2', 'query', 'Signed limit by region', 'running'],
      ['h2', 'query', undefined, 'done'],
    ]);
    expect(progress[1].id).toBe(progress[2].id); // the UI updates the query line in place
  });

  it('names unknown tools without any special wording', () => {
    const { trace } = run([top('tool-call-input-streaming-start', { toolCallId: 'x', toolName: 'web_search-tool' })]);
    expect(trace[0]).toMatchObject({ label: 'web search tool', status: 'running' });
  });

  it('keeps leftover text as the answer when the stream ends without a closing step', () => {
    expect(run([top('text-delta', { text: 'Done.' })]).answer).toBe('Done.');
  });
});

describe('crisp', () => {
  it('keeps the first sentence of a thought', () => {
    expect(crisp('I notice the data only has 2023 and 2024.  Let me check   2022.')).toBe('I notice the data only has 2023 and 2024.');
  });

  it('cuts a long sentence at a word', () => {
    const long = `I'll query ${'the capacity metrics '.repeat(12)}now`;
    const out = crisp(long);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out).toMatch(/metrics…$/);
  });
});
