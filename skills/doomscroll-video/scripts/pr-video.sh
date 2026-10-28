#!/usr/bin/env bash
# One command for the current branch's PR: submit its DoomScroll video (published on the PR when you can write to it and
# Stealth is off, else shareable by link), post the "cooking" GIF comment on the PR with your
# own gh (edited, not repeated, on a re-run), and print where the video will be. Every argument (--notes <file>,
# --screen <image>=<caption>, --language <id>, --auto, ...) is passed on to doomscroll.mjs pr.
# Usage: pr-video.sh [--pr <url>] [doomscroll.mjs options]
# MIT License. See ../../../LICENSE.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pr=""
if [ "${1:-}" = "--pr" ]; then pr="${2:?--pr needs a URL}"; shift 2; fi
if [ -z "$pr" ]; then
  pr="$(gh pr view --json url,state -q 'select(.state=="OPEN").url' 2>/dev/null || true)"
fi
if [ -z "$pr" ]; then
  echo "pr-video: no open pull request for this branch; open one first (gh pr create) or pass --pr <url>" >&2
  exit 1
fi

result="$(node "$here/doomscroll.mjs" pr "$pr" --publish --or-shareable --comment --no-wait "$@")"
printf '%s\n' "$result"
watch="$(printf '%s' "$result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).watchUrl||"")}catch{}})')"
if [ -n "$watch" ]; then echo "Watch: $watch" >&2; fi
