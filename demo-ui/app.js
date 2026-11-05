// TEMPORARY demo page: ask a question, show the answer, the data and the chart as JSON. Nothing else.
const threadId = `demo-${crypto.randomUUID()}`;
const form = document.getElementById('ask');
const input = document.getElementById('question');
const send = document.getElementById('send');
const history = document.getElementById('history');

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The answer is Markdown; the demo shows it as plain paragraphs with **bold** kept.
function renderAnswer(target, text) {
  target.replaceChildren();
  for (const block of text.split(/\n{2,}/)) {
    const p = el('p');
    block.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', '', part.slice(2, -2)));
      else p.append(document.createTextNode(part.replace(/^#+\s*/gm, '')));
    });
    target.append(p);
  }
}

function renderTable(result) {
  if (!result.columns.length) return null;
  const wrap = el('div', 'block');
  wrap.append(el('h3', '', `Data · ${result.rows.length < result.totalRows ? `${result.rows.length} of ${result.totalRows}` : result.totalRows} rows`));
  const scroll = el('div', 'table');
  const table = el('table');
  const head = el('tr');
  result.columns.forEach((c) => head.append(el('th', '', c)));
  table.append(head);
  for (const row of result.rows) {
    const tr = el('tr');
    row.forEach((v) => tr.append(el('td', '', v === null || v === undefined ? '–' : String(v))));
    table.append(tr);
  }
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function renderChartJson(result) {
  const charts = result.charts ?? [];
  const wrap = el('div', 'block');
  wrap.append(el('h3', '', charts.length ? `Chart data (JSON) · ${charts.length}` : 'Chart data (JSON)'));
  wrap.append(el('pre', '', charts.length ? JSON.stringify(charts.length === 1 ? charts[0] : charts, null, 2) : 'No chart for this question.'));
  return wrap;
}

// Reads the Server-Sent Events of one answer. Only the answer text, the final result and errors are used.
async function ask(question) {
  const turn = el('article', 'turn');
  turn.append(el('div', 'question', question));
  const status = el('div', 'status', 'Working on it…');
  const answer = el('div', 'answer');
  turn.append(status, answer);
  history.append(turn);
  turn.scrollIntoView({ behavior: 'smooth', block: 'end' });

  const res = await fetch('/bi/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId, message: question }) });
  if (res.status === 401) {
    document.getElementById('login').hidden = false;
    status.textContent = 'Please sign in first.';
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    status.textContent = body.error ?? `The request failed (${res.status}).`;
    return;
  }

  let text = '';
  let buffer = '';
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!line.startsWith('data: ')) continue; // keep-alive comments
      const event = JSON.parse(line.slice(6));
      if (event.type === 'text') renderAnswer(answer, (text += event.delta));
      else if (event.type === 'text-reset') renderAnswer(answer, (text = ''));
      else if (event.type === 'error') status.textContent = event.message;
      else if (event.type === 'final') {
        status.remove();
        renderAnswer(answer, event.result.answer || text);
        const table = renderTable(event.result);
        if (table) turn.append(table);
        turn.append(renderChartJson(event.result));
      }
    }
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  send.disabled = true;
  try {
    await ask(question);
  } catch {
    history.lastElementChild?.querySelector('.status')?.replaceChildren('The answer could not be loaded. Is the main server running?');
  } finally {
    send.disabled = false;
    input.focus();
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
