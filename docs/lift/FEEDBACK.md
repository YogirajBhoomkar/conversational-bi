# Send feedback email (Proposed)

For the people who run Conversational BI and read the feedback it produces. **Proposed**: the client has not confirmed this feature. It ships switched off and is removable with `git revert` of its two commits.

## What the user sees

Under every finished answer, including error turns and declined off-topic questions, there is a **Send feedback** button. It appears only when `BI_FEEDBACK_EMAIL` is set. Clicking it opens a small panel:

1. One click on what was wrong: *Wrong numbers, Wrong data source, Chart or table issue, Too slow, Should have been refused, Other* (none chosen counts as Other).
2. An optional one-line comment (up to 300 characters).
3. **Open email**: the user's own email app opens with a filled-in message to the configured address. They read it, can edit it, and press Send.

The app sends nothing itself and keeps no feedback store: the email is the channel. The thumbs up and down (Genie's own feedback, `POST /bi/feedback`) are unchanged.

## What the email contains

| Part | Content |
|---|---|
| Subject | `[Conversational BI] Feedback - ref <first 8 characters of the trace id>` |
| My feedback | The six types, the chosen one marked, and the comment |
| The exchange | The question and the answer (as plain text), depending on `BI_FEEDBACK_CONTENT` |
| References | Feedback ref, user ref, chat id, turn, time, app build and contract, Genie ids |

Never in the email: the SQL, the user's name or email address, any token.

Examples, built from a made-up turn by `ui/scripts/feedback-example.ts`: [the plain-text body](feedback-example/email-body.txt), [the link](feedback-example/mailto-link.txt), [the HTML body](feedback-example/email.html) and [the .eml draft](feedback-example/feedback-0f1e2d3c.eml).

## Which reference finds what

| Reference | Where to look it up |
|---|---|
| Feedback ref | The trace id of the turn. Search the logs (Datadog) for `traceId:<ref>`: every line of that answer, including `chat.turn`, `genie.ask` and the `feedback.opened` count |
| User ref | The `user` field of the logs: a one-way hash of the user id, so the logs never hold who it was |
| Chat id | The `chatId` field: every turn of that chat |
| Turn | The position of the answer in the chat |
| Genie ids | `<conversation id>/<message id>` per data source: the same exchange on the Genie side, in the Databricks workspace |

## text or eml (`BI_FEEDBACK_FORMAT`)

| | `text` (default) | `eml` |
|---|---|---|
| How | A `mailto:` link opens the default email app | The browser downloads a `.eml` draft; opening it shows an unsent message (`X-Unsent: 1`) |
| Body | Plain text, laid out as a card | HTML: coloured type pills, tables, the full question and answer |
| Length | The whole link is limited to `BI_FEEDBACK_MAX_URL_CHARS` (1900) **after URL encoding**; the answer is shortened to fit, marked `...[shortened]` | Up to 8,000 characters each for the question and the answer |
| Works with | Any email app | Outlook desktop; other apps may open the file differently |

Why: a `mailto:` link can carry plain text only, and email apps and browsers cut links at roughly 2,000 characters. The limit counts the link after encoding. A space costs 3 characters there, a line break 6, and a character outside ASCII up to 12, so the fixed parts take about half the budget. A long or non-English answer is shortened sooner.

## What leaves the app (`BI_FEEDBACK_CONTENT`)

| Value | The email holds |
|---|---|
| `full` (default) | The question and the answer |
| `question` | The question only |
| `ids` | The references only, no chat text |

**For the client's approval:** with `full`, the question and the answer of the chat go into an email in the user's own mailbox, to the configured address. The user sees and can edit everything before sending, and the app sends nothing by itself. `question` and `ids` reduce what leaves. Being Proposed, this needs the client's approval, including which addresses may receive it.

## What the service records

`POST /bi/feedback/opened` logs `feedback.opened` with the trace id, user ref, turn, format and type, and nothing else. That gives counts of feedback by type even when an email is never sent. The comment, question and answer never reach the server through this route.
