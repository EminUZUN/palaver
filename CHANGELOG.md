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
- Tested with Claude Code, Codex and Antigravity (`agy`).
- Dockerfile, docker-compose and systemd examples; CI for GitLab and GitHub.
- Hardened after an independent review: hostile hello frames cannot crash the relay;
  overlapping member names are refused; messages are confirmed only after they are
  stored; at most 50 unconfirmed messages per receiver, none dropped on disconnect;
  the tmux injector pastes into one pane by id, keeps messages on disk until pasted and
  no longer stalls on its own disclaimer; `palaver wait` keeps queued messages and sends
  roles; `palaver tmux` forwards settings into an existing tmux server; unreadable
  settings files are reported; systemd example uses LoadCredential.
- Second review round: the injector also pins the agent pane's process and stops if the
  pane is respawned; the unconfirmed-message limit is per recipient across connections;
  `palaver tmux` hands the caller's settings to the agent through a private 0600 file
  and ignores stale values in a running tmux server; `palaver wait` never confirms a
  message it could not print; `@role` queues for busy online peers and reports skips;
  tests run on a private tmux server.
