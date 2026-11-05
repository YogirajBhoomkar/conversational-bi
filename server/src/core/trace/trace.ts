import type { TraceItem } from '../../contracts';
import type { SpaceRegistry } from '../genie/registry';

// Turns the supervisor's stream into the scratchpad the UI shows: the agents' own working notes (the text they write before
// a tool call or handover), one entry per tool call or handover, and Genie's progress under the call that produced it.
// The text of a step that calls no tool is the final answer. Nothing about the business is written here: names come from the space registry.
type Sink = {
  trace: (item: TraceItem) => void;
  answer: (delta: string) => void;
};

const HANDOVER = 'agent-genie_';

// The parts of a Mastra stream chunk the tracer reads. Mastra puts them under `payload`; older chunks have them at the top.
type Payload = {
  text?: string;
  textDelta?: string;
  toolName?: string;
  toolCallId?: string;
  args?: { prompt?: unknown; question?: unknown; query?: unknown };
  result?: { error?: unknown };
  stepResult?: { reason?: string };
  output?: { type?: string; payload?: Payload };
};
export type TraceChunk = Payload & { type: string; payload?: Payload };

const clip = (s: unknown, max = 300) => {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const describeTool = (toolName: string, spaceName: (key: string) => string): { label: string; by?: string } => {
  if (toolName.startsWith(HANDOVER)) return { label: `Hand over to ${spaceName(toolName.slice(HANDOVER.length))}` };
  const ask = /^ask-(.+)$/.exec(toolName);
  if (ask) return { label: 'Ask Genie', by: spaceName(ask[1]) };
  const full = /^fetch-full-(.+)$/.exec(toolName);
  if (full) return { label: 'Load full result', by: spaceName(full[1]) };
  return { label: toolName.replace(/^agent-/, '').replace(/[-_]+/g, ' ') };
};

// What was sent to the tool or agent, shown under its entry.
const detailOf = (args: Payload['args']) => clip(args?.prompt ?? args?.question ?? args?.query);

export function createTracer(sink: Sink, registry: SpaceRegistry) {
  const spaceName = (key: string) => registry.byKey(key)?.name ?? key;
  let n = 0;
  const nextId = (prefix: string) => `${prefix}${++n}`;
  // The Ask Genie entry each space's progress lines belong to (data agents can run at the same time), and the latest one.
  const askOf = new Map<string, string>();
  let currentAsk: string | undefined;

  // The supervisor and each running handover buffer the text of their current step separately, so notes of agents
  // that run at the same time are not mixed.
  const SUPERVISOR = 'supervisor';
  const texts = new Map<string, string>();

  const flushNote = (level: string, by?: string) => {
    const text = clip(texts.get(level), 600);
    texts.delete(level);
    if (text) sink.trace({ id: nextId('note'), kind: 'note', text, by });
  };

  const onChunk = (level: string, type: string, p: Payload | undefined, by?: string) => {
    switch (type) {
      case 'text-delta':
        texts.set(level, (texts.get(level) ?? '') + (p?.text ?? p?.textDelta ?? ''));
        break;
      case 'tool-call-input-streaming-start':
      case 'tool-call': {
        flushNote(level, by); // text written before a tool call is the agent's working note, not the answer
        const toolName = String(p?.toolName ?? '');
        const ask = /^ask-(.+)$/.exec(toolName);
        if (level !== SUPERVISOR && ask && p?.toolCallId) {
          askOf.set(ask[1], p.toolCallId);
          currentAsk = p.toolCallId;
        }
        const detail = type === 'tool-call' ? detailOf(p?.args) : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', ...describeTool(toolName, spaceName), status: 'running', ...(detail ? { text: detail } : {}) });
        break;
      }
      case 'tool-result': {
        const error = typeof p?.result?.error === 'string' ? p.result.error : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', ...describeTool(String(p?.toolName ?? ''), spaceName), status: error ? 'error' : 'done', ...(error ? { text: clip(error) } : {}) });
        break;
      }
      case 'step-finish': {
        const calledTools = p?.stepResult?.reason === 'tool-calls';
        // A supervisor step that called no tool is the final answer. A data agent's closing report is internal, so it is dropped.
        const answer = texts.get(SUPERVISOR);
        if (level === SUPERVISOR && !calledTools && answer) sink.answer(answer);
        texts.delete(level);
        break;
      }
    }
  };

  return {
    handle(chunk: TraceChunk) {
      const p = chunk?.payload ?? chunk;
      if (chunk?.type === 'tool-output') {
        // The data agent's own stream arrives nested inside the supervisor's handover call.
        const inner = p?.output;
        const toolName = String(p?.toolName ?? '');
        const key = toolName.startsWith(HANDOVER) ? spaceName(toolName.slice(HANDOVER.length)) : undefined;
        if (inner?.type) onChunk(`handover:${p?.toolCallId ?? toolName}`, inner.type, inner.payload, key);
        return;
      }
      onChunk(SUPERVISOR, String(chunk?.type), p);
    },
    // One line of Genie's own progress, shown under the Ask Genie entry of its space (or the latest one).
    progress(text: string, spaceKey?: string) {
      const line = clip(text, 400);
      const parent = (spaceKey && askOf.get(spaceKey)) || currentAsk;
      if (line) sink.trace({ id: nextId('progress'), kind: 'progress', text: line, parent });
    },
    // Safety net: if the stream ended without a closing step, whatever text is left is the answer.
    end() {
      const answer = texts.get(SUPERVISOR);
      if (answer) sink.answer(answer);
      texts.delete(SUPERVISOR);
    },
  };
}
