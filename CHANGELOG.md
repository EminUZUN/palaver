# Changelog

## 0.1.1 (2026-10-06)

- The relay image is built for amd64 and arm64 (0.1.0 was amd64 only).
- Updated the README with installation instructions for the npm package
  (`npm install -g palaver-agents`), the relay image from ghcr.io, and the Claude Code
  plugin (`/plugin marketplace add EminUZUN/palaver`, then `/plugin install palaver@palaver`).
- Updated the release workflow to stage each npm version for maintainer approval
  (`npm stage publish`), wait for approval before publishing the MCP Registry entry,
  and create a GitHub Release using the corresponding changelog section.
- Updated the README and examples to publish the Docker relay port on a single private
  or VPN address and clarify that agents still send conversation data to their AI providers.

## 0.1.0 (2026-10-06)

First public version.

- Relay: WebSocket hub with shared-token and per-member-token authentication (per-member tokens allow the member's name and
  `<member>-...` aliases), offline queues, delivery acknowledgements with requeue on disconnect,
  `@role` / `@all` fan-out, per-connection rate limit, `/healthz`, protocol version check.
- MCP server: `list_peers`, `send_message`, `wait_for_message`, `read_inbox`; push into
  Claude Code through channels when enabled, otherwise a private local inbox.
- `palaver tmux`: run Codex or any terminal agent in tmux and paste incoming messages
  into it, holding while an approval prompt is on screen; a message that looks like a prompt
  is left for `read_inbox` instead of being typed.
- CLI: `relay`, `mcp`, `tmux`, `list`, `send`, `wait`, `listen`.
- Tested with Claude Code, Codex and Antigravity (`agy`).
- Distribution: Claude Code plugin and marketplace (`/plugin marketplace add EminUZUN/palaver`,
  then `/plugin install palaver@palaver`; relay settings through `userConfig`); MCP Registry entry
  (`server.json`); release workflow that publishes to npm, the relay image to ghcr.io and
  the MCP Registry on a version tag.
- `npm run test:e2e`: optional tests with real Claude Code, Codex and Antigravity agents
  in two Docker containers, checking broadcasts and message passing through every agent.
  These tests run locally; CI runs the automated suite on Linux with Node.js 20 and 22.
  Releases use npm trusted publishing, the built-in `GITHUB_TOKEN` for container images,
  and GitHub OIDC for the MCP Registry.
- Dockerfile, docker-compose and systemd examples; CI for GitLab and GitHub; ESLint.
- Security and reliability: hostile hello frames cannot crash the relay;
  overlapping member names are refused; messages are acknowledged only after they are
  stored in the local inbox, printed by the CLI, or sent as a channel notification; at most 50 unconfirmed messages per receiver, none dropped on disconnect;
  the tmux injector pastes into one pane by id, keeps messages on disk until pasted and
  does not mistake its message disclaimer for an approval prompt; `palaver wait` keeps queued messages and sends
  roles; `palaver tmux` forwards settings into an existing tmux server; unreadable
  settings files are reported; systemd example uses LoadCredential.
- Session isolation and delivery: the injector also pins the agent pane's process and stops if the
  pane is respawned; the unconfirmed-message limit is per recipient across connections;
  `palaver tmux` hands the caller's settings to the agent through a private 0600 file
  and ignores stale values in a running tmux server; `palaver wait` never confirms a
  message it could not print; `@role` queues for busy online peers and reports skips;
  tests run on a private tmux server.
- Process checks and configuration: the injector's process check and paste run as one atomic tmux
  command (`if-shell -F`), so a pane respawned mid-delivery is never typed into;
  double-quoted `.env` values decode JSON-style escapes, so session settings round-trip
  tokens containing quotes, backslashes or newlines.
