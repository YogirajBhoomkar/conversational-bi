import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../contracts';
import { sseResponse } from './http';

describe('sseResponse', () => {
  it('writes one `data:` line per event, byte for byte', async () => {
    async function* events(): AsyncGenerator<ChatEvent> {
      yield { type: 'text', delta: 'hi' };
      yield { type: 'error', message: 'x' };
    }
    const res = sseResponse(events(), new AbortController());
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toBe('data: {"type":"text","delta":"hi"}\n\ndata: {"type":"error","message":"x"}\n\n');
  });

  it('aborts the turn and stops the event source when the client disconnects', async () => {
    const abort = new AbortController();
    let stopped = false;
    // A turn that runs until it is aborted, like handleChat.
    async function* events(): AsyncGenerator<ChatEvent> {
      try {
        yield { type: 'text', delta: 'first' };
        await new Promise((resolve) => abort.signal.addEventListener('abort', resolve));
      } finally {
        stopped = true;
      }
    }
    const reader = sseResponse(events(), abort).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(abort.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(stopped).toBe(true);
  });
});
