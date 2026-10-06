# Contributing

Thanks for helping. palaver aims to stay small, so please keep that in mind.

## Principles

- **Keep it simple.** The relay should stay a single small process with no database. Prefer
  documenting a standard tool (VPN, TLS proxy, systemd) over building it in.
- **Security first.** Every message is text that another agent may act on. Changes that
  touch authentication, names or how messages reach an agent need a test.
- **Agent-neutral.** Features should work for any MCP-capable agent; agent-specific code
  belongs at the edges (`lib/tmux.js`, push detection in `lib/mcp.js`).

## Workflow

1. Open an issue first for larger changes, to agree on the approach.
2. `npm install && npm test` must pass. The suite starts its own relay on a random port
   and never touches your real settings. tmux tests run when tmux 3.2+ is installed.
3. Keep commits focused, and describe *why* in the message.
4. Update README.md and CHANGELOG.md when behavior or settings change.

## Layout

```
bin/palaver.js   CLI entry point (relay, mcp, tmux, send, list, wait, listen)
lib/relay.js     WebSocket hub: auth, routing, queues, fan-out, rate limit
lib/client.js    relay client (heartbeat, reconnect, request/ack)
lib/mcp.js       MCP server: tools and push/inbox delivery
lib/inbox.js     per-user local inbox (one file per message)
lib/tmux.js      tmux launcher and message injector
lib/config.js    settings, names, state directory
```

## Conduct

Be respectful and constructive. Harassment or personal attacks are not tolerated in
issues, merge requests or any other project space.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
