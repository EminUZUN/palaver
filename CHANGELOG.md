# Changelog

## 0.1.0 (unreleased)

First public version.

- Relay: WebSocket hub with shared-token and per-member-token auth (members can only use
  their own names), offline queues, delivery acknowledgements with requeue on disconnect,
  `@role` / `@all` fan-out, per-connection rate limit, `/healthz`, protocol version check.
- MCP server: `list_peers`, `send_message`, `wait_for_message`, `read_inbox`; push into
  Claude Code through channels when enabled, otherwise a private local inbox.
- `palaver tmux`: run Codex or any terminal agent in tmux and paste incoming messages
  into it, holding while an approval prompt is on screen.
- CLI: `relay`, `mcp`, `tmux`, `list`, `send`, `wait`, `listen`.
- Dockerfile, docker-compose and systemd examples; CI for GitLab and GitHub.
