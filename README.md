# Doomscroll for coding agents

Ask your coding agent for a video of your PR or your changes. It gets back a narrated explainer, made on
[Doomscroll](https://doomscroll.build)'s servers.

## Install

```bash
npx skills add doomscroll-build/doomscroll-plugin
```

Works with Claude Code, Codex, Cursor, Gemini CLI and [more](https://skills.sh). Then ask your agent:

> Make a Doomscroll video of my changes

The first time, the agent shows you a sign-in link. Approve it with GitHub. You get 5 free videos a day.

Claude Code plugin instead: `/plugin marketplace add doomscroll-build/doomscroll-plugin`, then
`/plugin install doomscroll@doomscroll` (it brings the MCP server too).

### Or connect the MCP server

One URL, `https://doomscroll.build/mcp`; your client opens a browser to sign in with GitHub (OAuth, no key to paste).

- **Claude Desktop / claude.ai**: Settings → Connectors → Add custom connector → `https://doomscroll.build/mcp`
- **Claude Code**: `claude mcp add --transport http doomscroll https://doomscroll.build/mcp`, then `/mcp` to sign in
- **Codex**: in `~/.codex/config.toml` add `[mcp_servers.doomscroll]` with `url = "https://doomscroll.build/mcp"`, then `codex mcp login doomscroll`
- **Gemini CLI**: `gemini mcp add -s user --transport http doomscroll https://doomscroll.build/mcp`, then `/mcp auth doomscroll`
- **Qwen Code**: `qwen mcp add --transport http doomscroll https://doomscroll.build/mcp`
- **Cursor**: in `~/.cursor/mcp.json`: `{"mcpServers": {"doomscroll": {"url": "https://doomscroll.build/mcp"}}}`

Tools: `create_video`, `get_video` (status, then the MP4, GIF and watch links) and `account`. No OAuth in your client?
Send `Authorization: Bearer <key>` with a key from Settings → Agent access.

## What happens

1. Your agent reads the change and the code around it, and writes notes: every component, how they connect, what
   changed and what could break.
2. Doomscroll turns the PR or diff plus the notes into a 30–90 second video, in any of 12 languages.
3. Your agent downloads the MP4 and helps you put it in the PR. Doomscroll never posts to GitHub on its own.

Each video costs one credit, refunded if it fails. The PR or diff and the notes are sent to Doomscroll and its AI
providers, so don't send code you can't share with them. Revoke access any time in Doomscroll **Settings → Agent
access**.

## API

The skill's script (`skills/doomscroll-video/scripts/doomscroll.mjs`, Node 18+, no dependencies) calls a small
bearer-token API (`Authorization: Bearer <key>`). The key comes from `doomscroll.mjs login` or `DOOMSCROLL_API_KEY`.

| Request | What it does |
| --- | --- |
| `POST /api/agent/videos` `{"pr": {"owner", "repo", "number", "sha"?}, "theme"?, "language"?, "notes"?}` | Video of a GitHub PR (default: its head commit) |
| `POST /api/agent/videos` `{"change": {"title", "description"?, "diff", "repo"?, "files"?: [{"path", "content"}]}, "theme"?, "language"?, "notes"?}` | Video of a unified diff (≤ 600 KB, ≤ 300 files, ≤ 40 excerpts of ≤ 100 KB) |
| `GET /api/agent/videos/<id>` | `status`, `stage`, `progress.percent`, and when done `video.mp4Url`, `video.gifUrl` (both need the key), `video.previewUrl` (public GIF), `video.watchUrl` |
| `GET /api/agent/me` | The key's GitHub login and credits |
| `POST /api/agent/v1/audio/speech`, `POST /api/agent/v1/audio/transcriptions` | OpenAI-compatible voice, metered in credits |
| `POST /api/agent/device`, `POST /api/agent/device/token` | Browser sign-in by device code |
| `POST /mcp` | The MCP server (Streamable HTTP; OAuth 2.1 with dynamic client registration and PKCE, or the key) |

`theme`: `classic` (default), `football` or `kpop`. `language`: one of `en ar es fr de pt tr hi id ja ko zh` (default:
your Doomscroll setting). `notes`: `summary`, `why`, `howItWorks`, `architecture`, `risks`, `audience` (text), `flows`
(≤ 10 strings) and `components` (≤ 20 of `{name, kind, role?, change?, tech?}`); the skill explains each field.

## License

MIT, see [LICENSE](LICENSE).
