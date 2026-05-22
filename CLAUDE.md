---
status: parked
last_touched: 2026-05-22
---

# strava-mcp (parked)

A hosted multi-tenant Strava MCP was specced and planned here on 2026-05-22, then **parked the same day** after discovering that an equivalent service already exists:

- **[stravamcp.com](https://stravamcp.com/) (SportMCP)** — hosted multi-tenant, "Connect with Strava" OAuth → unique MCP URL, 21 tools across Activities / Segments / Profile & Gear / Social & Clubs / Routes, Cloudflare Workers infrastructure.

Tim's first move is to connect via SportMCP. This project is reference-only.

Related existing services (also surfaced 2026-05-22 search):

- **Athlete Data MCP** — multi-source fitness MCP (Strava + Garmin + Whoop + Oura + Hevy + Intervals.icu). Different scope; could be a future pivot if SportMCP doesn't cover what Tim needs.
- **Composio Strava MCP** and **Merge Agent Handler** — hosted via larger toolkit platforms.
- 9+ open-source stdio implementations: r-huijts/strava-mcp (popular, `npx @r-huijts/strava-mcp-server`), ctvidic, eddmann, yorrickjansen, tomekkorbak, mdecesare13, bronteee, theagilepadawan, plus PyPI `strava-activity-mcp-server`.

## Reviving this project

Only revive if SportMCP has a concrete gap Tim runs into (missing tool, privacy / data-path ownership requirement, integration with another tim-os service like MMP, or a planned pivot to a multi-source fitness MCP).

If reviving:

- Spec: `docs/superpowers/specs/2026-05-22-strava-mcp-design.md`
- Plan: `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md` (22 TDD tasks)

The plan mirrors the proven `~/tim-os/ctca-crm` pattern (path-token MCP, Drizzle + Neon, Next 15).
