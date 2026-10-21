---
name: doomscroll
description: Make a short narrated Doomscroll video that explains a GitHub pull request or the local changes on this branch, download the MP4, and help put it in the PR. Use when the user asks for a video, explainer, walkthrough or "doomscroll" of a PR, a diff or their changes.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/doomscroll.mjs *)
---

# Doomscroll video

Doomscroll (https://doomscroll.build) turns a pull request or a diff into a 45–90 second narrated portrait video. This skill is a thin client: the video is made on the Doomscroll server. Each video costs one Doomscroll credit (a failed video is refunded).

## Before you start

- The user's key must be in the `DOOMSCROLL_API_KEY` environment variable. Never print, echo, log or paste it, and never write it to a file. If it is missing, tell the user: "Create a key at doomscroll.build → Settings → Agent access, then `export DOOMSCROLL_API_KEY=…` in the shell you start your agent from."
- Tell the user once that the PR or diff is sent to Doomscroll and its AI providers to make the video. Do not send changes the user has said are confidential.
- Themes: `classic` (default, an animated review explainer, a few minutes), `football` or `kpop` (AI video footage, much slower). Use classic unless the user asks.

## 1. Collect the context

- **An existing PR**: you need `owner/repo#number` (or its github.com URL). `gh pr view --json url -q .url` finds the current branch's PR. Doomscroll reads the PR itself with the user's GitHub sign-in, so send nothing else.
- **Local changes, no PR yet**: the script diffs the branch against where it left the base branch, including uncommitted work. Write a one-line `--title` and a short `--description` of what the change does and why, from what you know. Optionally `--include` up to a few key changed files (whole contents) so the video can explain them better. Use `--base <ref>` if the base is not the default branch, or `--diff-file <path>` for a diff you prepared.

## 2. Submit, wait, download

Run from the repository (Node 18+). It prints progress on stderr and one JSON line on stdout, and polls every 10 seconds:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/doomscroll.mjs pr acme/widget#42 --out doomscroll.mp4 --gif doomscroll.gif
node ${CLAUDE_SKILL_DIR}/scripts/doomscroll.mjs local --title "Cache search results" --description "Adds an in-memory cache in front of the index." --out doomscroll.mp4 --gif doomscroll.gif
```

Run it in the background or with a long timeout: a classic video usually takes a few minutes. Other commands: `status <id>`, `download <id> --out file.mp4`, `me` (checks the key, shows credits). Exit codes: 2 the video failed (the JSON has `error`), 3 key missing or revoked, 4 out of credits, 5 still running after `--timeout` minutes (resume later with `status`/`download`).

Result: `{"id","status":"succeeded","mp4","gif","previewUrl","watchUrl"}`. `previewUrl` is a public silent GIF; `watchUrl` opens the PR's card on Doomscroll (PR videos only; null for local changes).

## 3. Put it in the PR

Doomscroll never posts to GitHub for agent videos. Offer the user these options and only post when they say so:

1. **Inline video (best)**: drag the downloaded MP4 into the PR description or a comment on github.com. GitHub uploads it as a user attachment and plays it inline (up to 10 MB on free plans; Doomscroll videos are under 10 MB). An agent cannot do this upload; the user does it in the browser. For a local change, do this after the PR is opened.
2. **GIF preview plus link, from the terminal**: for a PR video, with the user's approval:

   ```bash
   gh pr comment 42 --repo acme/widget --body "[![Video walkthrough](PREVIEW_URL)](WATCH_URL)"
   ```

   Replace `PREVIEW_URL` and `WATCH_URL` with the values from the result. The GIF plays for everyone on GitHub (silent, captions burned in). The watch link opens the PR on Doomscroll, where an agent video's narrated version is shown only to the user who made it, so for reviewers the inline MP4 is better.

## Opting out

Revoking the key in Doomscroll Settings → Agent access turns agent access off at once.
