# Send feedback email (Proposed)

For the people who run Conversational BI and read the feedback it produces. **Proposed**: the client has not confirmed this feature. It ships switched off and is removable with `git revert` of its commits.

## What the user sees

Under every finished answer, including error turns and declined off-topic questions, there is a **Send feedback** button. It appears only when `BI_FEEDBACK_EMAIL` is set. Clicking it opens a small panel:

1. One click on what was wrong: *Wrong numbers, Wrong data source, Chart or table issue, Too slow, Should have been refused, Other* (none chosen counts as Other).
2. An optional one-line comment (up to 300 characters).
3. **Open email**: the user's email app opens with the message filled in: To, Subject and body. They read it, can edit it, and press Send.

If no email app opens (none is set up, or only Outlook on the web is used), the notice under the button offers **Copy email text**. It copies the same email, and the notice then gives the address and subject to paste it under. If the clipboard is blocked as well, the notice gives the address and the short ref to quote.

The app sends nothing itself and keeps no feedback store: the email is the channel. The thumbs up and down (Genie's own feedback, `POST /bi/feedback`) are unchanged.

## What the email contains

The email is plain text, because that is all a `mailto:` link can carry. It is laid out for how Outlook shows plain text, in a proportional font: short headings in capitals, a blank line between sections, and one `Label: value` per line, with nothing that needs columns to line up.

| Part | Content |
|---|---|
| Subject | `[Conversational BI] Feedback - ref <first 8 characters of the trace id>` |
| WHAT WAS WRONG | The chosen type, and the comment if there is one |
| MY QUESTION, THE ANSWER I GOT | The question and the answer, depending on `BI_FEEDBACK_CONTENT`. Markdown is turned into plain text; a table becomes one row per line, cells separated by ` \| ` |
| REFERENCES | Below a line: feedback ref, user ref, chat id, turn, time, app build and contract, Genie ids |

Never in the email: the SQL, the user's name or email address, any token.

Example, built from a made-up turn by `ui/scripts/feedback-example.ts`: [the body](feedback-example/email-body.txt) and [the link](feedback-example/mailto-link.txt).

## Which reference finds what

| Reference | Where to look it up |
|---|---|
| Feedback ref | The trace id of the turn. Search the logs (Datadog) for `traceId:<ref>`: every line of that answer, including `chat.turn`, `genie.ask` and the `feedback.opened` count |
| User ref | The `user` field of the logs: a one-way hash of the user id, so the logs never hold who it was |
| Chat id | The `chatId` field: every turn of that chat |
| Turn | The position of the answer in the chat |
| Genie ids | `<conversation id>/<message id>` per data source: the same exchange on the Genie side, in the Databricks workspace |

## Length (`BI_FEEDBACK_MAX_URL_CHARS`)

Email apps and browsers cut `mailto:` links at roughly 2,000 characters, so the whole link is kept within `BI_FEEDBACK_MAX_URL_CHARS` (1900), counted **after URL encoding**. A space costs 3 characters there, a line break 6, and a character outside ASCII up to 12. The references always stay. The question gets about 300 characters first, then the answer gets what is left. Each is cut on a word boundary and marked `...[shortened]`. A long or non-English answer is shortened sooner. The example's link is 1,375 characters, with nothing shortened.

The whole answer is always in the chat, and the feedback ref finds it in the logs. Copy email text has no such limit: it copies up to 8,000 characters each of the question and answer.

## What leaves the app (`BI_FEEDBACK_CONTENT`)

| Value | The email holds |
|---|---|
| `full` (default) | The question and the answer |
| `question` | The question only |
| `ids` | The references only, no chat text |

**For the client's approval:** with `full`, the question and the answer of the chat go into an email in the user's own mailbox, to the configured address. The user sees and can edit everything before sending, and the app sends nothing by itself. `question` and `ids` reduce what leaves. Being Proposed, this needs the client's approval, including which addresses may receive it.

## What the service records

`POST /bi/feedback/opened` logs `feedback.opened` with the trace id, user ref, turn and type, and nothing else. That gives counts of feedback by type even when an email is never sent. The comment, question and answer never reach the server through this route.

## Why not a designed (HTML) email

A web page cannot open an email app with an HTML email in it: `mailto:` carries plain text only. An HTML email would have to come as a downloaded `.eml` file that the user then opens, which is one step too many for everyday use. Sending it from the server would need a mail service and would take away the user's look at the email before it goes. Putting a draft into the user's mailbox through Microsoft 365 would need mailbox write access for the app. So the email is plain text, and it is laid out to read well.
