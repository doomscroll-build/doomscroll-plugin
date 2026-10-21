# Doomscroll for coding agents

Make a short narrated video that explains a pull request, or the changes on your branch, straight from your coding
agent: Claude Code, Codex, Cursor, Gemini CLI or anything that can run a shell command.

[Doomscroll](https://doomscroll.build) turns a PR into a 45–90 second portrait explainer (what it was, what changed,
what could break, what merging means). This repository is only a thin client: a skill that tells your agent what to do
and one dependency-free Node script (`skills/doomscroll/scripts/doomscroll.mjs`) that submits, waits and downloads.
The video is made on the Doomscroll server.

## One-minute setup

1. Sign in at [doomscroll.build](https://doomscroll.build) with GitHub, open **Settings → Agent access** and create an
   API key. It is shown once.
2. Put it in your shell profile (never commit it):

   ```bash
   export DOOMSCROLL_API_KEY=dsk_...
   ```

3. Install the client for your agent (below), then ask: *"make a Doomscroll video for this PR"* or *"make a Doomscroll
   video of my changes"*.

Needs Node 18 or newer. Check the key with `node skills/doomscroll/scripts/doomscroll.mjs me`.

### Claude Code

```text
/plugin marketplace add doomscroll-build/doomscroll-plugin
/plugin install doomscroll@doomscroll
```

The skill is then available as `/doomscroll:doomscroll`, and Claude also uses it on its own when you ask for a video.

### Codex CLI

Clone this repository somewhere, then add to your project's `AGENTS.md` (or `~/.codex/AGENTS.md`):

```markdown
For Doomscroll videos of a PR or local changes, follow /path/to/doomscroll-agent/AGENTS.md.
```

Codex runs the script through its shell tool; allow network access for `doomscroll.build` if your sandbox blocks it.

### Cursor

Clone this repository, then add a rule `.cursor/rules/doomscroll.mdc`:

```markdown
---
description: Make a Doomscroll explainer video of a pull request or local changes
alwaysApply: false
---
Follow /path/to/doomscroll-agent/AGENTS.md when asked for a Doomscroll video.
```

### Gemini CLI

Clone this repository, then reference it from `GEMINI.md` (project or `~/.gemini/GEMINI.md`):

```markdown
For Doomscroll videos of a PR or local changes, follow /path/to/doomscroll-agent/AGENTS.md.
```

### Any other agent, or by hand

```bash
node skills/doomscroll/scripts/doomscroll.mjs pr acme/widget#42 --out doomscroll.mp4 --gif doomscroll.gif
node skills/doomscroll/scripts/doomscroll.mjs local --title "Cache search results" --out doomscroll.mp4
```

Run with `--help` for every option. `DOOMSCROLL_URL` points it at another Doomscroll server.

## Putting the video in your PR

Doomscroll never posts to GitHub for agent-made videos. You choose:

- **Inline video**: drag the MP4 into the PR description or a comment on github.com. GitHub hosts it as an attachment
  and plays it inline.
- **GIF preview and link**: `gh pr comment 42 --body "[![Video walkthrough](<previewUrl>)](<watchUrl>)"` with the URLs
  the script prints.

## Privacy

To make a video, the PR (title, description and diff, read with your own GitHub sign-in) or the local diff, title,
description and any files you include are sent to Doomscroll and processed by its AI providers (for the storyboard,
narration and, for football and K-pop, video footage). Don't send code you aren't allowed to share with them. The key
only makes videos with your credits and reads their status; it cannot act on GitHub.

## Opt-in and opt-out

Agent access is off until you create a key. Revoke it in **Settings → Agent access** to turn it off immediately;
creating a new key replaces the old one. Each video costs one Doomscroll credit, refunded if the video fails.

## API

The script uses a small bearer-token API (`Authorization: Bearer $DOOMSCROLL_API_KEY`):

| Request | What it does |
| --- | --- |
| `POST /api/agent/videos` `{"pr": {"owner", "repo", "number", "sha"?}, "theme"?}` | Video of a GitHub PR (default: its head commit) |
| `POST /api/agent/videos` `{"change": {"title", "description"?, "diff", "repo"?, "files"?: [{"path", "content"}]}, "theme"?}` | Video of a unified diff (≤ 600 KB, ≤ 300 files, ≤ 40 excerpts of ≤ 100 KB) |
| `GET /api/agent/videos/<id>` | `status` (`queued`, `running`, `succeeded`, `failed`), `stage`, `progress.percent`, and when done `video.mp4Url`, `video.gifUrl` (both need the key), `video.previewUrl` (public GIF), `video.watchUrl` |
| `GET /api/agent/me` | The key's GitHub login and credits |

`theme` is `classic` (default), `football` or `kpop`.

## License

MIT, see [LICENSE](LICENSE).
