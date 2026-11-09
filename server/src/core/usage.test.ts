import { Agent } from '@mastra/core/agent';
import { describe, expect, it } from 'vitest';
import type { BiLogger } from '../ports/logger';
import { stubModel } from './agents/stubModel';
import { getCollector } from './chat/collector';
import { handleChat, type ChatDeps } from './chat/handleChat';
import { createSpaceRegistry } from './genie/registry';
import { createUsageMeter, meter, withMeter } from './usage';

const step = (toolCallId: string, agent: string, inputTokens: number, outputTokens: number) => ({
  type: 'tool-output',
  payload: { toolCallId, toolName: `agent-${agent}`, output: { type: 'step-finish', payload: { output: { usage: { inputTokens, outputTokens } } } } },
});
const delegate = (toolCallId: string, agent: string) => ({ type: 'tool-call', payload: { toolCallId, toolName: `agent-${agent}` } });

describe('usage meter', () => {
  it('sums each agent, and the total is the sum of the parts', () => {
    const m = createUsageMeter();
    m.add('bi_supervisor', { inputTokens: 10, outputTokens: 2 });
    m.observe(delegate('c1', 'genie_a'));
    m.observe(step('c1', 'genie_a', 100, 20));
    m.observe(step('c1', 'genie_a', 50, 10)); // a second step of the same run
    m.add('suggest_agent', { inputTokens: 7, outputTokens: 3 });
    expect(m.snapshot().tokens).toEqual({
      total: { inputTokens: 167, outputTokens: 35 },
      byAgent: { bi_supervisor: { inputTokens: 10, outputTokens: 2 }, genie_a: { inputTokens: 150, outputTokens: 30 }, suggest_agent: { inputTokens: 7, outputTokens: 3 } },
      complete: true,
    });
  });

  it('keeps what a sub-agent used before it failed', () => {
    const m = createUsageMeter();
    m.observe(delegate('c1', 'genie_a'));
    m.observe(step('c1', 'genie_a', 40, 4)); // then the run fails: no further chunks
    expect(m.snapshot().tokens.byAgent.genie_a).toEqual({ inputTokens: 40, outputTokens: 4 });
  });

  it('says complete: false when a source did not report', () => {
    const silent = createUsageMeter();
    silent.add('bi_supervisor', undefined);
    expect(silent.snapshot().tokens.complete).toBe(false);
    const noSteps = createUsageMeter();
    noSteps.observe(delegate('c1', 'genie_a')); // delegated, but no usage ever arrived
    expect(noSteps.snapshot().tokens.complete).toBe(false);
  });

  it('counts Genie calls, failures, retries and time', () => {
    const m = createUsageMeter();
    m.genieCall({ durationMs: 1200, failed: false });
    m.genieCall({ durationMs: 300, failed: true });
    m.genieRetry();
    expect(m.snapshot().genie).toEqual({ calls: 2, failed: 1, retries: 1, totalMs: 1500 });
  });

  it('is reached through the turn scope, and outside a turn records nowhere that matters', async () => {
    const m = createUsageMeter();
    await withMeter(m, async () => {
      await Promise.resolve();
      meter().genieRetry();
    });
    meter().genieRetry();
    expect(m.snapshot().genie.retries).toBe(1);
  });
});

describe('chat.turn log with real agents and stub models', () => {
  it('reports every agent the turn ran, with a total equal to the sum', async () => {
    const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger: BiLogger = { debug() {}, info: (event, fields = {}) => void lines.push({ event, fields }), warn() {}, error() {}, child: () => logger };
    const sub = stubModel([{ text: 'Placements: 42' }], { inputTokens: 100, outputTokens: 50 });
    const child = new Agent({ id: 'genie_placement', name: 'genie_placement', description: 'placement data', instructions: 'c', model: sub.model });
    const sup = stubModel([{ toolName: 'agent-genie_placement', args: { prompt: 'How many placements?' } }, { text: 'There are 42.' }], { inputTokens: 10, outputTokens: 5 });
    const supervisor = new Agent({ id: 'bi_supervisor', name: 'bi_supervisor', instructions: 's', model: sup.model, agents: { genie_placement: child } });
    const sug = stubModel([{ text: '{"questions":[]}' }], { inputTokens: 7, outputTokens: 3 });
    const suggestAgent = new Agent({ id: 'suggest_agent', name: 'suggest_agent', instructions: 'x', model: sug.model });
    // The data agent here has no Genie tool, so the turn records the result its tool would have (our follow-ups are
    // written only for a turn that got data).
    const withResult: ChatDeps['supervisor'] = {
      stream: ((messages: unknown, options: { requestContext: Parameters<typeof getCollector>[0] }) => {
        getCollector(options.requestContext).results.push({ spaceId: 'id-1', question: 'q', summary: '42', sql: 'SELECT 42', columns: ['n'], rows: [[42]], totalRows: 1, thinking: [], suggestedQuestions: [], statementId: null, conversationId: 'c', messageId: 'm', error: null });
        return (supervisor.stream as (m: unknown, o: unknown) => ReturnType<typeof supervisor.stream>)(messages, options);
      }) as unknown as typeof supervisor.stream,
    };
    const deps: ChatDeps = {
      supervisor: withResult, suggestAgent, registry: createSpaceRegistry([{ key: 'placement', name: 'Placement', description: 'd', spaceId: 'id-1' }]),
      modelLabel: 'stub', suggestWaitMs: 2000, genieMode: 'conversation', logger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false },
    };
    for await (const _ of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: 'How many placements?' })) void _;
    const turn = lines.find((l) => l.event === 'chat.turn')?.fields;
    expect(turn?.tokens).toEqual({
      total: { inputTokens: 127, outputTokens: 63 },
      byAgent: {
        genie_placement: { inputTokens: 100, outputTokens: 50 },
        bi_supervisor: { inputTokens: 20, outputTokens: 10 }, // two steps
        suggest_agent: { inputTokens: 7, outputTokens: 3 }, // no Genie follow-ups, so ours were written
      },
      complete: true,
    });
    expect(JSON.stringify(turn)).not.toContain('How many placements'); // no content in the log line
  });
});
