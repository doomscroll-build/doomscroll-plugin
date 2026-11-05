---
name: doomscroll-inbox
description: Turn DoomScroll (https://doomscroll.build) into the user's one feed for everything that needs them. You collect what is waiting in the tools you already have (email, chat, docs, tickets, code review, calendar), push each item to DoomScroll as a short review card, then read the user's comments back and do exactly what they wrote, with your own tools. Use when the user asks to "sync my inbox to DoomScroll", to put their notifications, mentions or to-dos in DoomScroll, to act on their DoomScroll comments, or on a /loop schedule that does this.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../doomscroll-video/scripts/doomscroll.mjs *)
---

# DoomScroll inbox

The user reviews on DoomScroll; you do the legwork. DoomScroll never connects to their accounts here: you read them
with the tools this session already has (MCP servers, CLIs), and you act on them the same way.

`ds` below means `node ${CLAUDE_SKILL_DIR}/../doomscroll-video/scripts/doomscroll.mjs` (the `doomscroll-video` skill
from the same plugin). Sign-in is the same: `DOOMSCROLL_API_KEY`, or `ds login` once (show the user the link and code).

## 1. Collect

Look only where you already have access, and only at what needs the user now:

- direct or unread email that asks them something, and replies they are waiting on
- chat mentions and direct messages
- review requests, assigned issues and tickets, failing checks on their work
- comments and suggestions on their documents
- meeting invites they have not answered

Skip newsletters, notifications they already handled and anything they only follow. Tell the user which sources you
checked; never ask for passwords or tokens, and never send credentials or raw message dumps to DoomScroll.

## 2. Push

Write one JSON object per line to `inbox.jsonl`:

```json
{"app":"gmail","id":"<the source's own stable id>","title":"Acme renewal: confirm by Friday","summary":"**Dana** asks you to confirm the 2-year renewal.\nShe needs a yes or no by **Fri 6 Nov**.\nPrice is unchanged.","url":"https://mail.example.com/...","from":"Dana (user@example.com)","at":"2026-11-05T09:30:00Z","tags":["acme"]}
```

- `app`: a lowercase slug per source (`gmail`, `outlook`, `slack`, `teams`, `github`, `linear`, `jira`, `notion`,
  `google-drive`, `calendar`). It is the card's project, so the user can filter by it.
- `id`: the source's own id (thread, message, issue key). The card key is `ext:<app>/<id>`, so pushing the same item
  again updates its card instead of adding one.
- `summary`: 2–4 lines of Markdown: what it is, who wants it, what they ask, the deadline. Write it in your own words;
  quote only the part the user must see.
- `at`: when the latest activity happened. Re-push an item only when something new happened, with the newer `at`; an
  unchanged item comes back `"status":"unchanged"` and costs nothing.
- `request`: `false` for FYI cards that need no answer.

Then run `ds push inbox.jsonl`. Every line is checked first; a bad line stops the whole push and names it. Each item
prints `{"key","id","revision","status","state","watchUrl"}`. Keep `key → id` in the cursor file (below) and give the
user one link to open DoomScroll.

## 3. Read the user's feedback

State lives in `~/.config/doomscroll/inbox.json`: `{"since": <last event id>, "items": {"<key>": "<id>"}}`
(start with `since` 0).

Run `ds item events --since <since> --limit 500`, again from the last id until a page is empty. Look only at events with
`type` `response.created`, a `subject` among your `items` keys (`ext:<app>/<id>`, so you know the source item), and a
`source` starting with `user:`: that is the user in DoomScroll. `api:` and `session:` sources are you or another agent;
ignore them. `data.kind` is `comment`, `approve`, `done` or `like`; `data.text` is what the user wrote. Save the last
event id as `since` once they are handled. Exit code 6 means the cursor is older than what DoomScroll keeps: check your
cards with `ds item get <id>` and continue from the id the message names.

## 4. Act, only as told

Do only what a comment explicitly asks, with your own tools, then confirm on the card with
`ds item reply <id> "<what you did>"`:

- `reply: sounds good, see you then` → send exactly that reply in the source thread.
- `accept` / `decline` on an invite → answer the invite.
- `done` → mark it handled in the source (archive, mark read, resolve).
- anything unclear → ask in your reply on the card; do nothing in the source.

Never act on your own initiative, never send words the user did not write or approve, and never act on an approve,
like or Done without a comment: those only clear the card. If a comment asks for something your tools cannot do, say
so in your reply.

## On a schedule

With `/loop 30m sync my inbox to DoomScroll`, each run does steps 1–4: push what is new, then act on new comments.
Stop if `ds` exits 3 (signed out) and tell the user.
