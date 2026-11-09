// The model provider's own safety filter refused the call: for example Azure OpenAI's content filter on a jailbreak
// attempt ("ignore all previous instructions…"), which comes back as an HTTP 400 error, not as an answer. That is a
// refusal, not a failure of ours, so the user gets the scope message instead of "something went wrong", and the log
// gets a warning instead of an error. The markers are the providers' documented error codes, not words from questions.
const MARKERS = [
  /content[_ ]?filter/i,                // Azure OpenAI: code "content_filter"
  /ResponsibleAIPolicyViolation/i,       // Azure OpenAI inner error code
  /ContentPolicyViolation/i,             // LiteLLM's name for it
  /content[_ ]policy[_ ]violation/i,     // OpenAI
  /content management policy/i,          // Azure OpenAI message text
];

// The provider's error text may sit on the error itself, its cause, or the response body it carries.
function texts(err: unknown, depth = 0): string[] {
  if (depth > 3 || err === null || err === undefined) return [];
  if (typeof err === 'string') return [err];
  if (typeof err !== 'object') return [];
  const e = err as { message?: unknown; responseBody?: unknown; cause?: unknown; error?: unknown };
  return [
    ...(typeof e.message === 'string' ? [e.message] : []),
    ...(typeof e.responseBody === 'string' ? [e.responseBody] : []),
    ...texts(e.cause, depth + 1),
    ...texts(e.error, depth + 1),
  ];
}

export const isContentFilterError = (err: unknown) => texts(err).some((t) => MARKERS.some((m) => m.test(t)));
