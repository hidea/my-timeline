---
name: travel-writing
description: Collect an event's Bluesky, X/Twilog, and Flickr records for a date range, reconstruct an evidence-backed chronology, select photos, and draft a Japanese event record. Use for event writing or recollection; not for maintaining a permanent personal archive.
---

# Travel Writing

Create a disposable, evidence-backed event-writing workspace with this repository's `my-timeline` CLI. Keep only the final article and selected images when the user finishes.

## Workflow

1. Determine the event title and inclusive start/end dates. Ask only when these cannot be inferred safely. The range must not exceed 31 days.
2. Run `node src/cli.js collect --from YYYY-MM-DD --to YYYY-MM-DD --title "行事名"`. Omit unavailable sources with `--sources`. Never print access tokens.
3. Tell the user the workspace path and point them to `timeline.html` and `materials/`.
4. Reconstruct the chronology in the user's chosen writing destination. Every asserted stop or event must cite one or more relative material paths. Mark plausible but unverified transitions as questions, not facts.
5. Prepare an outline, then draft the article after the user confirms the chronology and selections. Do not create writing files inside the disposable timeline workspace unless the user explicitly asks for them.
6. Copy only the confirmed article and selected media to the user's chosen destination.
7. Delete the workspace only after explicit confirmation. Report exactly what was deleted.

## Source behavior

- Bluesky comes from bskylog MCP, normally `http://localhost:8080/sse`.
- X comes from Twilog MCP through the existing `mcp-remote` OAuth session. `TWILOG_MCP_TOKEN` is an optional direct-Bearer override.
- Flickr needs `FLICKR_API_KEY` and `FLICKR_USER_ID`.
- Report a failed source and continue when another source produced material.

Read [references/writing.md](references/writing.md) before reconstructing an itinerary or drafting prose.
