# Doomscroll videos (for any coding agent)

When the user asks for a Doomscroll video, explainer or walkthrough of a pull request or of their local changes, follow
`skills/doomscroll/SKILL.md` in this repository. Where it says `${CLAUDE_SKILL_DIR}`, use the absolute path of
`skills/doomscroll` in your checkout of this repository.

The short version:

1. The key is in `DOOMSCROLL_API_KEY`. Never print, log or store it. Without it, tell the user to create one at
   doomscroll.build → Settings → Agent access.
2. Tell the user the PR or diff goes to Doomscroll and its AI providers.
3. Run `node <path>/skills/doomscroll/scripts/doomscroll.mjs pr owner/repo#123 --out doomscroll.mp4 --gif doomscroll.gif`
   for a PR, or `... local --title "<one line>" --description "<what and why>" --out doomscroll.mp4 --gif doomscroll.gif`
   for local changes. It submits, polls and downloads; it can take several minutes.
4. Offer to put it in the PR: the user drags the MP4 into the PR description or a comment on github.com (GitHub plays
   it inline), or, with their approval, `gh pr comment` with `[![Video walkthrough](previewUrl)](watchUrl)`.
   Doomscroll never posts to GitHub for agent videos.
