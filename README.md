# DoomScroll for coding agents

Ask your coding agent for a video of your PR or your changes. It gets back a narrated explainer, made on the servers of
DoomScroll ([doomscroll.build](https://doomscroll.build)), and a doomscroll.build link to watch it.

## Install

For Claude Code:

```bash
npx --yes skills add doomscroll-build/doomscroll-plugin -g -y -a claude-code
```

Works with Claude Code, Codex, Cursor, Gemini CLI and [more](https://skills.sh). Then ask your agent:

> Make a DoomScroll video of my changes

The first time, one page opens in your browser: sign in with GitHub and click Approve. You get 5 free videos a day.

As a plugin instead (Claude Code, Cursor and the other agents `npx plugins targets` lists; the same skill, the same
one-page sign-in): `npx --yes plugins add doomscroll-build/doomscroll-plugin -y`, or in Claude Code
`/plugin marketplace add doomscroll-build/doomscroll-plugin` then `/plugin install doomscroll@doomscroll`.

### Automatic videos (the Claude Code plugin)

The plugin adds three small hooks. They only add a line of context for your agent: they call nothing and send nothing themselves.

- **After `gh pr create` or a `git push` to a branch with an open PR**, your agent makes that PR's video in the background with `scripts/pr-video.sh` (one credit, never twice for the same commit), posts one PR comment from your own `gh` whose GIF shows "cooking" until the video is ready, and gives you the link. If the DoomScroll GitHub App already makes your PR videos, the agent just hands you that video's link and nothing is charged.
- **After a long explanation**, it asks "Would you like to see this explanation as an animated video?"
- **When you hand over a batch of tasks or overnight work**, it asks once whether to add the results to your DoomScroll feed as videos.

When you ask for a video yourself, it opens in your browser, and the agent also prints the link and the MP4's path. Turn the automatic part off with
`node <skill>/scripts/doomscroll.mjs auto off` (or `DOOMSCROLL_AUTO=0`); `auto on` brings it back. The skill alone (`npx skills add`) has no hooks.

### Or connect the MCP server

Optional and separate from the skill, for clients without a terminal. One URL, `https://doomscroll.build/mcp`; your client opens a browser to sign in with GitHub (OAuth, no key to paste).

- **Claude (web, desktop, mobile)**: [**Add to Claude**](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=DoomScroll&connectorUrl=https%3A%2F%2Fdoomscroll.build%2Fmcp) (opens Claude's connector dialog already filled in: click Add, then Connect)
- **Claude Code**: `claude mcp add --transport http --scope user doomscroll https://doomscroll.build/mcp`, then `/mcp` to sign in
- **Codex**: in `~/.codex/config.toml` add `[mcp_servers.doomscroll]` with `url = "https://doomscroll.build/mcp"`, then `codex mcp login doomscroll`
- **Gemini CLI**: `gemini mcp add -s user --transport http doomscroll https://doomscroll.build/mcp`, then `/mcp auth doomscroll`
- **Qwen Code**: `qwen mcp add --transport http doomscroll https://doomscroll.build/mcp`
- **Cursor**: in `~/.cursor/mcp.json`: `{"mcpServers": {"doomscroll": {"url": "https://doomscroll.build/mcp"}}}`

The install command above targets the Claude Code skill only. Neither it nor the plugin registers the MCP server. For another agent, select that current agent with the installer's `-a` option and use global installation only if that agent supports it. Do not default to all agents globally.

Tools: `create_video`, `get_video`, `set_video_sharing` and `account`. A local-change video is public only to anyone with its unguessable link by default; a PR video defaults private. Either can be changed later. No OAuth in your client?
Send `Authorization: Bearer <key>` with a key from Settings → Agent access.

## What happens

1. Your agent reads the change and the code around it, and writes notes: every component, how they connect, what
   changed and what could break. For a change you can see, it walks through the real UI and captures before/after
   screenshots (a screen recording becomes up to 4 key frames).
2. DoomScroll turns the PR or diff plus the notes and screenshots into a 1–2 minute portrait video, in any of 12 languages:
   one animated diagram of the real components, in four chapters (Currently → The change → After → Blast radius), cutting
   to your screenshots, ending on what merging means.
3. Your agent downloads the MP4, or explicitly requests PR publication with `publish: true` / `--publish`. DoomScroll posts
   status, its hosted preview/link and failure guidance using your GitHub account. No organization App installation is needed.
   Default requests remain private. Stealth mode must be off and repository write access is required. Videos are never uploaded to GitHub.

Each video costs one credit, refunded if it fails. The PR or diff and the notes are sent to DoomScroll and its AI
providers, so don't send code you can't share with them. Revoke access any time in DoomScroll **Settings → Agent
access**.

## API

The skill's script (`skills/doomscroll-video/scripts/doomscroll.mjs`, Node 18+, no dependencies) calls a small
bearer-token API (`Authorization: Bearer <key>`). The key comes from `doomscroll.mjs login` or `DOOMSCROLL_API_KEY`.

| Request | What it does |
| --- | --- |
| `POST /api/agent/videos` `{"pr": {"owner", "repo", "number", "sha"?}, "theme"?, "language"?, "notes"?, "screens"?, "shareable"?, "publish"?, "auto"?, "source"?: {"tmuxSession", "tmuxPane", "cwd"}}` | Video of a GitHub PR (default: its head commit; sharing defaults off). One video per PR commit: a published one (e.g. the DoomScroll bot's) or your own is returned instead of a new one, at no charge. `auto: true` (you are making it unasked) answers `200 {"video": null, "automatic": true, "watchUrl"}` when the GitHub App will make it. With `screens` it makes and publishes the video itself instead, replacing the App's screenless one of that commit. `automatic: false` plus `connectUrl` means GitHub is not connected for automatic videos |
| `POST /api/agent/videos` `{"change": {"title", "description"?, "diff", "repo"?, "files"?: [{"path", "content"}]}, "theme"?, "language"?, "notes"?, "screens"?, "shareable"?, "source"?: {"tmuxSession", "tmuxPane", "cwd"}}` | Video of a unified diff (sharing defaults on; ≤ 600 KB, ≤ 300 files, ≤ 40 excerpts of ≤ 100 KB). `source` (sent by the client inside tmux) is where comments on the video can be delivered |
| `GET /api/agent/videos/<id>` | Status/progress, `publish`, `shareable`, `links`, and when ready authenticated downloads |
| `POST /api/agent/videos/<id>/sharing` `{"shareable": true|false}` | Enable or revoke its stable unguessable public MP4 link |
| `GET /api/agent/events?since=<id>&limit=<n>` | What changed for this key's login after event `since` (exclusive; default 0, ≤ 500 per page), oldest first, as `{events: [{id, type, source, subject, time, task, media, data}]}`: `task.queued` / `task.stage` / `task.failed` / `task.succeeded` (`media` = the finished video's token) and `submission.created` (`data.duplicate`). Events are kept 30 days; `410 {resync: true}` means `since` is older than what is kept, so re-read your videos and continue from the newest id |
| `GET /api/agent/me` | The key's GitHub login, credits and `connection` (`automatic`: the GitHub App makes your PR videos by itself; `installations`, `finished`, `failed`, `connectUrl`) |
| `POST /api/agent/github` `{"text"}` | The user's GitHub CLI tokens (`gh auth status --show-token` output, sent by `doomscroll.mjs gh` after the user agrees), so DoomScroll reads orgs where the App is not installed; answers `{connected, skipped}` |
| `POST /api/agent/v1/audio/speech`, `POST /api/agent/v1/audio/transcriptions` | OpenAI-compatible voice, metered in credits |
| `POST /api/agent/device`, `POST /api/agent/device/token` | Browser sign-in by device code |
| `POST /mcp` | The MCP server (Streamable HTTP; OAuth 2.1 with dynamic client registration and PKCE, or the key) |

`doomscroll.mjs pr <PR> --comment` posts one PR comment with your own `gh` right after submitting: the `previewUrl` GIF (a
"cooking" animation until the video is ready, then its preview) linking to `watchUrl` ("▶ Watch on doomscroll.build"); a re-run edits it, and it is skipped
when DoomScroll posts on the PR itself. `scripts/pr-video.sh [--pr <url>] [options]` runs that for the current branch's PR
with `--publish --or-shareable --no-wait` (published on the PR when you can write to it and Stealth is off, else shareable
with a "Play the MP4" link in the comment) and prints the watch link.

`doomscroll.mjs watermark <video>` adds the same watermark, outro and jingle to any video with your local ffmpeg (logo in
`skills/doomscroll-video/assets/`).

Every video answer carries `links` from the moment it is queued: where the video will be. `watchUrl` is the page to show the user as a clickable link: `https://doomscroll.build/watch/<token>`, which anyone holding the link can watch without signing in (an unlisted video: a published PR video or one shared by link), else the sign-in gated card for a private video; `appUrl` is always the in-app card (`/?pr=…` or `/?local=…`); `previewUrl` is the public silent GIF; `shareUrl` the raw public MP4 when sharing is on. They go live when it is done (until then the watch page says the video is still cooking), so a workflow can pass them on without waiting.

`publish`: PR-only explicit opt-in, default `false`. Repeating a completed private request with publication enabled reuses its saved video without another render or credit. This does not enable public MP4 sharing. Installing the MCP server or the skill alone does not submit PRs; only the Claude Code plugin's hooks do, and `auto off` stops them.

`shareable`: local changes default `true`; PR videos default `false`. Shared, `watchUrl` is its unlisted watch page and the stable `video.shareUrl` its MP4, both keyed by a random 128-bit locator. Change it later with `doomscroll.mjs share <id>` / `unshare <id>` or `set_video_sharing`. `screens`: up to 4 `{caption, image}` screenshots of the UI the change touches (image = a base64 data URL, PNG/JPEG/WebP ≤ 1.5 MB); the video cuts to each one. `theme`: `classic` (default), `football` or `kpop`. `language`: one of `en ar es fr de pt tr hi id ja ko zh` (default:
your DoomScroll setting). `notes`: `summary`, `why`, `howItWorks`, `architecture`, `risks`, `audience` (text), `flows`
(≤ 10 strings) and `components` (≤ 20 of `{name, kind, role?, change?, tech?}`); the skill explains each field.

## License

MIT, see [LICENSE](LICENSE).


## Stored review items

Allow-listed accounts can post video, audio, image, HTML bundles, text, and URL cards without rendering them.
The JSON file is the `POST /api/agent/items` body. Its `manifest` maps relative file paths to
SHA-256 hashes; files live relative to that JSON file. `panelBlobs` uses the same format.
The client uploads missing bytes in resumable parts, verifies local hashes, then submits.
One file uses its SHA as the revision; a bundle uses the SHA of its sorted manifest JSON.
Panels and tags are annotations, not reviewed bytes. `postedAt` preserves source chronology.

```sh
node doomscroll.mjs item post manifest.json
node doomscroll.mjs item follow <id>
node doomscroll.mjs item feedback --project demo --since 0 --latest 1 --json
node doomscroll.mjs item get <id>                     # the raw {item}: current revision, state, responses
node doomscroll.mjs item reply <id> "Ready for another look" --revision <sha>   # the revision you reviewed; a newer one = 409, no comment
node doomscroll.mjs item tags <id> audio,ready
node doomscroll.mjs item project demo scheme.json     # {"verdicts":[{"id":"ship","label":"Ship","tone":"accept"}]}
node doomscroll.mjs item events --since 0 --limit 100  # raw API JSON; exit 6 + {"error":"resync",...} when the cursor was swept
```

Every call has a deadline covering headers and body (`DOOMSCROLL_TIMEOUT_MS`, default 30000 for one small read; writes
and long polls 2x, a 64 MiB upload part and voice calls 10x, an MP4 download 20x). Reads (GET/HEAD) get 3 bounded
attempts honoring `Retry-After` (capped at the read deadline); 429/5xx on all of them is exit 7, never a refusal. A reply,
tag edit, item or voice call is sent once, and its 5xx is reported as refused (exit 1). A redirect is never followed and is
refused. An upload part whose answer is lost re-reads the server's verified offset (`HEAD`) and resumes there, never
re-sending committed bytes; three recoveries without progress give up (exit 7). The `HEAD` must carry all three upload
headers consistent with the file, or the upload is refused before any byte is sent. Once every byte is committed the server
hashes them: the client polls with growing pauses, never re-PUTs, up to the upload deadline (10x), then exit 7. An empty
file is refused as bad input before any request for that file. `item reply` without `--revision` reads the item's current revision
first; with it, exactly that revision is sent and a stale one is the server's 409 (no comment is created). While a video
renders, `pr`/`local` poll every 10 s (or `DOOMSCROLL_TIMEOUT_MS` when smaller) and ride out 429 (`Retry-After` honored,
capped) and 5xx until `--timeout`, then exit 7; the paid create request is never repeated. `DOOMSCROLL_PART_BYTES`
shrinks upload parts on slow links. Exit codes: 1 refused or bad input, 2 video failed, 3 not signed in, 4 out of credits,
5 still running, 6 events cursor swept (re-read state, continue from a newer cursor), 7 unreachable after the bounded
attempts or deadlines (retry later; nothing is assumed done).

| Route | Contract |
|---|---|
| `HEAD /api/agent/blobs/:sha256` | 200 complete, 204 partial, 404 unknown to this account; `Upload-Offset`, `Upload-Length`, `Upload-Complete` headers |
| `PUT /api/agent/blobs/:sha256` | Raw `application/octet-stream`, `Content-Range: bytes start-end/total`, parts up to 64 MiB; `{sha256,bytes,offset,complete}` |
| `POST /api/agent/items` | `{item:{key,title,description?,tags?},manifest,entry,kind,revision?,panels?,panelBlobs?,request?,postedAt?,source?}`; `kind` is video/audio/image/html/text/url; answers `{submissionId,itemKey,itemId,mediaId,revision,duplicate,links,state}`; `links.watchUrl` is the item's doomscroll.build page (`/?item=<key>&owner=<you>`, sign-in gated): show it to the user |
| `POST /api/agent/items/:id/follow` | `{source:{tmuxSession,tmuxPane,cwd}}`; explicitly bind this session to future feedback on current bytes; answers `{item,revision,following:true,state,done}` |
| `GET /api/agent/items/:id` | `{item}` with revisions, media, responses, derived pending/accepted/blocked state and `links.watchUrl` |
| `GET /api/agent/items?tags=a,b&project=demo` | `{items}`; tags use AND |
| `PUT /api/agent/items/:id/tags` | `{tags:["a","b"]}`; answers `{item}` |
| `PUT /api/agent/projects/:name` | `{verdicts:[{id,label,emoji?,tone}]}`; tone accept/revise/reject; answers `{project:{name,verdicts}}` |
| `POST /api/agent/items/:id/responses` | `{kind,revision,option?,text?,source?}`; kind approve/verdict/comment/like/done/clear; optional source identifies an API sender and prevents self-echo; stale revision 409; answers `{response,state,duplicate}` |
| `GET /api/agent/responses?project=demo&since=0&latest=1` | `{responses}`; durable history, numeric response-ID cursor, each row includes current derived state |
| `GET /api/agent/tags` | `{tags:[{tag,count}]}` |
| `GET /api/agent/events?since=0&limit=100` | `{events:[{id,type,source,subject,time,data}]}` (CloudEvents fields, `id` = sequence); 410 `{error,resync:true}` when `since` is older than the retained log |

Keys are `ext:<project>/<subject>` or `local:<sha>`. Requesting a review requires `request:true`.
A new upload returns 201; replay/joined returns 200 without a charge. `clear` withdraws a verdict;
likes and Done are not verdicts. Stored cards appear in My Reviews when enabled on the server. Uploaded HTML stays
inert until activation and requires a separately configured cookieless content host.

### Feedback notifications

Inside tmux, `item post`, `pr`, and `local` attach the exact session, pane, and pane working directory. `item follow` explicitly attaches an existing item at its current revision. Reads and help do not subscribe. `item reply` includes the sender context without creating a binding, so its own feedback is not echoed back.

When the operator enables source delivery, comments and approvals notify the attached session through the existing HTTP adapter. Registered HTTPS callbacks use signed event webhooks. Delivery is at least once; a received message is not proof the workflow acted on it. Old imports without a destination cannot resume a session automatically. Follow returns current state so a caller does not wait for an approval that happened before it attached.

`approve` is acceptance of exact reviewed bytes and completes that review. A configured project needs an accept-tone option; a project without options needs no option. `clear` withdraws it. Legacy `done` and `like` never become approvals. A blocking review remains authoritative even when another reviewer approved.
