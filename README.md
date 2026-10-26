# DoomScroll for coding agents

Ask your coding agent for a video of your PR or your changes. It gets back a narrated explainer, made on
[DoomScroll](https://doomscroll.build)'s servers.

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

### Or connect the MCP server

Optional and separate from the skill, for clients without a terminal. One URL, `https://doomscroll.build/mcp`; your client opens a browser to sign in with GitHub (OAuth, no key to paste).

- **Claude Desktop / claude.ai**: Settings → Connectors → Add custom connector → `https://doomscroll.build/mcp`
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
   changed and what could break.
2. DoomScroll turns the PR or diff plus the notes into a 30–90 second video, in any of 12 languages.
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
| `POST /api/agent/videos` `{"pr": {"owner", "repo", "number", "sha"?}, "theme"?, "language"?, "notes"?, "screens"?, "shareable"?, "publish"?}` | Video of a GitHub PR (default: its head commit; sharing defaults off) |
| `POST /api/agent/videos` `{"change": {"title", "description"?, "diff", "repo"?, "files"?: [{"path", "content"}]}, "theme"?, "language"?, "notes"?, "screens"?, "shareable"?}` | Video of a unified diff (sharing defaults on; ≤ 600 KB, ≤ 300 files, ≤ 40 excerpts of ≤ 100 KB) |
| `GET /api/agent/videos/<id>` | Status/progress, `publish`, `shareable`, and when ready authenticated downloads plus `video.shareUrl` when sharing is on |
| `POST /api/agent/videos/<id>/sharing` `{"shareable": true|false}` | Enable or revoke its stable unguessable public MP4 link |
| `GET /api/agent/me` | The key's GitHub login and credits |
| `POST /api/agent/v1/audio/speech`, `POST /api/agent/v1/audio/transcriptions` | OpenAI-compatible voice, metered in credits |
| `POST /api/agent/device`, `POST /api/agent/device/token` | Browser sign-in by device code |
| `POST /mcp` | The MCP server (Streamable HTTP; OAuth 2.1 with dynamic client registration and PKCE, or the key) |

`doomscroll.mjs watermark <video>` adds the same watermark, outro and jingle to any video with your local ffmpeg (logo in
`skills/doomscroll-video/assets/`).

`publish`: PR-only explicit opt-in, default `false`. Repeating a completed private request with publication enabled reuses its saved video without another render or credit. This does not enable public MP4 sharing. Installing the MCP server does not automatically submit every PR.

`shareable`: local changes default `true`; PR videos default `false`. The stable `video.shareUrl` contains a random 128-bit locator. Change it later with `doomscroll.mjs share <id>` / `unshare <id>` or `set_video_sharing`. `screens`: up to 4 `{caption, image}` screenshots of the UI the change touches (image = a base64 data URL, PNG/JPEG/WebP ≤ 1.5 MB); the video cuts to each one. `theme`: `classic` (default), `football` or `kpop`. `language`: one of `en ar es fr de pt tr hi id ja ko zh` (default:
your DoomScroll setting). `notes`: `summary`, `why`, `howItWorks`, `architecture`, `risks`, `audience` (text), `flows`
(≤ 10 strings) and `components` (≤ 20 of `{name, kind, role?, change?, tech?}`); the skill explains each field.

## License

MIT, see [LICENSE](LICENSE).
