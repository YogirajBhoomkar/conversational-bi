import { describe, expect, it } from 'vitest';
import type { TraceItem } from '../../contracts';
import { createSpaceRegistry } from '../genie/registry';
import { createTracer } from './trace';

const registry = createSpaceRegistry([
  { key: 'placement', name: 'Lab – Placement Core', description: 'Placement counts and premium.', spaceId: 's1' },
  { key: 'capacity', name: 'Lab – Capacity & Reinsurer', description: 'Reinsurer capacity.', spaceId: 's2' },
]);

// Chunk shapes captured from a real supervisor stream.
const top = (type: string, payload: object) => ({ type, payload });
const nested = (outerTool: string, type: string, payload: object, outer = 'outer') => ({ type: 'tool-output', payload: { toolName: outerTool, toolCallId: outer, output: { type, payload } } });
const finish = (reason: string) => ({ stepResult: { reason } });

// Records what the UI would receive: trace items, and the answer as streamed deltas (a retraction clears it).
const tracer = () => {
  const trace: TraceItem[] = [];
  const deltas: string[] = [];
  let answer = '';
  const t = createTracer({ trace: (i) => trace.push(i), answer: (d) => (deltas.push(d), (answer += d)), retract: () => (deltas.push('<retract>'), (answer = '')) }, registry);
  return { t, trace, deltas, answer: () => answer };
};
const run = (chunks: any[]) => {
  const { t, trace, deltas, answer } = tracer();
  chunks.forEach((c) => t.handle(c));
  t.end();
  return { trace, deltas, answer: answer() };
};
// The latest state of each trace entry, as the UI shows it after applying every update.
const latest = (trace: TraceItem[]) => [...trace.reduce((m, i) => m.set(i.id, { ...m.get(i.id), ...i }), new Map<string, TraceItem>()).values()];

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
    // The plan streams into one note as it is written.
    expect(trace.slice(0, 2)).toEqual([
      { id: 'note1', kind: 'note', text: 'Comparing placed limit' },
      { id: 'note1', kind: 'note', text: 'Comparing placed limit with signed capacity.' },
    ]);
    expect(trace[2]).toMatchObject({ id: 'c1', kind: 'tool', label: 'Lab – Placement Core', status: 'running' });
    expect(trace[3]).toMatchObject({ id: 'c1', text: 'Placed limit by region' });
    expect(trace[4]).toMatchObject({ id: 'c1', status: 'done' });
  });

  it('streams the answer word by word once data is back', () => {
    const { deltas, answer } = run([
      top('tool-call', { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt: 'q' } }),
      top('tool-result', { toolCallId: 'c1', toolName: 'agent-genie_placement', result: {} }),
      top('step-finish', finish('tool-calls')),
      top('text-delta', { text: '**EMEA leads** ' }),
      top('text-delta', { text: 'with 1,737.2M.' }),
      top('step-finish', finish('stop')),
    ]);
    expect(deltas).toEqual(['**EMEA leads** ', 'with 1,737.2M.']);
    expect(answer).toBe('**EMEA leads** with 1,737.2M.');
  });

  it('takes a streamed answer back into the plan when another data source is asked after all', () => {
    const { trace, deltas, answer } = run([
      top('tool-call', { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt: 'q' } }),
      top('tool-result', { toolCallId: 'c1', toolName: 'agent-genie_placement', result: {} }),
      top('step-finish', finish('tool-calls')),
      top('text-delta', { text: 'Now checking capacity.' }),
      top('tool-call', { toolCallId: 'c2', toolName: 'agent-genie_capacity', args: { prompt: 'q2' } }),
    ]);
    expect(deltas).toEqual(['Now checking capacity.', '<retract>']);
    expect(answer).toBe('');
    expect(latest(trace).filter((i) => i.kind === 'note').map((i) => i.text)).toEqual(['Now checking capacity.']);
  });

  it('treats the text of a step that calls no tool as the final answer', () => {
    const { trace, answer } = run([top('text-delta', { text: 'Hello. ' }), top('text-delta', { text: 'Ask me about placements.' }), top('step-finish', finish('stop'))]);
    expect(answer).toBe('Hello. Ask me about placements.');
    expect(latest(trace)).toEqual([{ id: 'note1', kind: 'note', text: '' }]); // it streamed as a plan, then left the scratchpad
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
    t.progress({ kind: 'thought', text: 'I will check which years exist. Then I will chart it.' }, 'placement'); // the same thought again
    t.progress({ kind: 'query', id: 'm:1', title: 'Signed limit by region', status: 'running' }, 'capacity');
    t.progress({ kind: 'query', id: 'm:1', status: 'done' }, 'capacity');
    const progress = trace.filter((i) => i.kind === 'progress');
    expect(progress.map((i) => [i.parent, i.step, i.text, i.status])).toEqual([
      ['h1', 'thought', 'I will check which years exist. Then I will chart it.', undefined], // in full
      ['h2', 'query', 'Signed limit by region', 'running'],
      ['h2', 'query', undefined, 'done'],
    ]);
    expect(progress[1].id).toBe(progress[2].id); // the UI updates the query line in place
  });

  it('keeps the line breaks of a question, so its parts stay readable', () => {
    const prompt = 'For 2020-2024:\r\n1.  Limit by year\n\n\n\n2. Limit by region  ';
    const { trace } = run([top('tool-call', { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt } })]);
    expect(trace[0].text).toBe('For 2020-2024:\n1. Limit by year\n\n2. Limit by region');
  });

  it('does not show the question to the user as a step', () => {
    const { trace } = run([
      top('tool-call', { toolCallId: 'q1', toolName: 'ask_user_to_choose', args: { question: 'Which year?', options: ['2023', '2024'] } }),
      top('tool-result', { toolCallId: 'q1', toolName: 'ask_user_to_choose', result: { shown: true } }),
    ]);
    expect(trace).toEqual([]);
  });

  it('names unknown tools without any special wording', () => {
    const { trace } = run([top('tool-call-input-streaming-start', { toolCallId: 'x', toolName: 'web_search-tool' })]);
    expect(trace[0]).toMatchObject({ label: 'web search tool', status: 'running' });
  });

  it('keeps leftover text as the answer when the stream ends without a closing step', () => {
    expect(run([top('text-delta', { text: 'Done.' })]).answer).toBe('Done.');
  });
});
