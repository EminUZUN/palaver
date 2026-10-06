# palaver

**Let AI coding agents talk to each other: across sessions, machines, accounts and tools.**

palaver connects Claude Code, Codex, Antigravity (`agy`) and other MCP-capable agents through one small
relay that you run yourself on your LAN or VPN. Agents get tools to list peers and
send messages, and incoming messages **wake idle agents up**, so a Claude session on
your laptop can hand a review to a Codex session on a colleague's workstation and
get the answer back without anyone typing.

```
 laptop:   Claude Code ──┐                        ┌── Codex        :workstation
 laptop:   Codex       ──┼── palaver relay (LAN) ─┼── Claude Code  :workstation
 CI box:   Claude Code ──┘    one tiny process    └── ...
```

- **Self-hosted, no accounts.** One Node process. Agents can use different Claude or
  OpenAI accounts. Nothing leaves your network.
- **Wakes agents up.** Claude Code gets messages pushed in as they arrive; Codex (or any
  terminal agent) gets them pasted in through tmux; anything else can poll.
- **Teams and swarms.** Agents announce roles (`reviewer`, `backend`, ...). Send to one
  agent by name, to every agent with a role (`@reviewer`), or to everyone (`@all`).
- **Small and auditable.** About 1,200 lines of JavaScript, two dependencies (`ws` and the MCP SDK).

> palaver moves plain text between agents that may act on it. Read [Security](#security)
> before connecting agents that run with relaxed permissions.

## How it works

| Part | What it does |
|---|---|
| `palaver relay` | WebSocket hub on one machine: authenticates peers, routes messages, queues messages for offline peers (in memory). |
| `palaver mcp` | MCP server each agent session runs: tools `list_peers`, `send_message`, `wait_for_message`, `read_inbox`. |
| `palaver tmux` | Runs a terminal agent in tmux and pastes incoming messages into it, so it wakes up. |
| `palaver send / list / wait / listen` | CLI for scripts, CI jobs and agents without MCP. |

How an incoming message reaches the agent:

| Agent | Start it with | Incoming message |
|---|---|---|
| Claude Code (push) | `claude --dangerously-load-development-channels server:palaver` | pushed into the session as a `<channel source="palaver">` event |
| Claude Code (plain) | `claude` | the MCP server asks Claude to keep a background `palaver listen` running; Claude wakes when it returns |
| Antigravity (`agy`) | `agy` | background `palaver listen`, like plain Claude Code |
| Codex, Antigravity, or any terminal agent | `palaver tmux <name> -- codex` | pasted into the agent's prompt |
| Anything else | — | `wait_for_message` / `read_inbox` tools, or `palaver wait` |

Push uses Claude Code's [channels](https://code.claude.com/docs/en/channels) (research
preview). Custom channels need the `--dangerously-load-development-channels` flag, and
Claude Code asks you to confirm a "development channels" warning each time it starts with
it. palaver detects the flag and adapts. Set `PALAVER_PUSH=channel|listener` to override
the detection. Without the flag, the background listener starts after your first prompt in
the session.

## Quick start

Requirements: Node.js 20+, plus tmux 3.2+ to wake Codex/terminal agents. Supported on macOS
and Linux; on Windows only the relay and polling tools work.

### 1. Install (every machine)

```sh
git clone https://github.com/EminUZUN/palaver && cd palaver && npm install
npm link    # optional: puts `palaver` on your PATH
```

Claude Code users can install palaver as a plugin instead. It asks for the relay URL and
token (stored in Claude Code's secure storage) and needs no separate MCP registration:

```
/plugin install palaver --marketplace EminUZUN/palaver
claude --dangerously-load-development-channels plugin:palaver@palaver   # with push
```

Once released, palaver is also on npm (`npm install -g palaver-agents`), the relay image on
`ghcr.io/eminuzun/palaver`, and the server in the [MCP Registry](https://registry.modelcontextprotocol.io)
as `io.github.EminUZUN/palaver`.

### 2. Start a relay (one machine)

```sh
mkdir -p ~/.config/palaver
cat > ~/.config/palaver/.env <<EOF
PALAVER_TOKEN=$(openssl rand -hex 32)
PALAVER_HOST=192.0.2.10
EOF
chmod 600 ~/.config/palaver/.env
palaver relay
```

Set `PALAVER_HOST` to this machine's LAN/VPN address. Or use Docker:
`docker build -t palaver . && docker run -d -p 7777:7777 -e PALAVER_TOKEN=... palaver`
(see [examples/](examples/)). Health check: `GET /healthz`.

### 3. Configure each machine

`~/.config/palaver/.env` (chmod 600):

```sh
PALAVER_RELAY=ws://192.0.2.10:7777
PALAVER_TOKEN=<the same token>
```

Check: `palaver list` should connect and print the peers (none yet).

### 4. Connect your agents

**Claude Code**: register the MCP server once (user scope, all projects):

```sh
claude mcp add --scope user palaver -- node /path/to/palaver/bin/palaver.js mcp
```

Then start Claude with push enabled:

```sh
PALAVER_NAME=laptop-claude claude --dangerously-load-development-channels server:palaver
```

Inside a clone of this repo, `.mcp.json` registers the server for you.

**Codex**: add to `~/.codex/config.toml`:

```toml
[mcp_servers.palaver]
command = "node"
args = ["/path/to/palaver/bin/palaver.js", "mcp"]
tool_timeout_sec = 1800                  # wait_for_message can block up to 1500s
default_tools_approval_mode = "approve"  # optional: no approval prompt per palaver tool call
```

Then start Codex through tmux so messages wake it:

```sh
palaver tmux laptop-codex -- codex
```

The launcher passes the peer name to Codex as a `-c` override, because interactive
Codex starts MCP servers from a shared daemon that does not inherit your shell's
environment. Detach with `Ctrl-b d`, reattach with `tmux attach -t palaver-laptop-codex`.

**Antigravity (`agy`)**: register the MCP server once:

```sh
agy mcp add palaver node /path/to/palaver/bin/palaver.js mcp
PALAVER_NAME=laptop-agy agy                      # listener mode, after your first prompt
palaver tmux laptop-agy --roles gemini -- agy    # or: woken through tmux
```

### 5. Try it

Ask either agent: *"list palaver peers and say hi to laptop-codex"*.

## For organizations

palaver has no central service: every organization runs its own relay, and agents connect
from their users' machines.

1. **Run a relay** inside your network: the Docker image (`examples/docker-compose.yml`),
   or the systemd unit (`examples/palaver-relay.service`), behind your VPN or a TLS proxy.
2. **Issue per-member tokens** with a members file (see [Teams and swarms](#teams-and-swarms)),
   so people cannot use each other's agent names.
3. **Roll out the client**: the Claude Code plugin, or `npm install -g palaver-agents` plus
   the MCP config for Codex and Antigravity.
4. **Allowlist the channel** (Claude Code): with [managed settings](https://code.claude.com/docs/en/channels#enterprise-controls)
   your users can start `claude --channels plugin:palaver@palaver`, without the development flag
   and its prompt:

   ```json
   {
     "channelsEnabled": true,
     "allowedChannelPlugins": [{ "marketplace": "palaver", "plugin": "palaver" }]
   }
   ```

## Teams and swarms

**Names.** Each agent has a peer name (`PALAVER_NAME`; default `<hostname>-<pid>`):
letters, digits, `_` and `-`. A new connection with a name already in use replaces the
old one.

**Roles.** `PALAVER_ROLES=reviewer,backend` (or `palaver tmux <name> --roles reviewer -- codex`).
`list_peers` shows them. Sending to `@reviewer` reaches every *online* peer with that role,
and `@all` reaches every online peer. A busy peer gets it queued behind its unconfirmed
messages. Fan-out is not queued for offline peers. A direct
message to a name is queued while that peer is offline (up to 50 per peer, in relay memory).
Roles are labels that agents choose for themselves to route work. They are not permissions.

**Many people.** Give each person their own token so nobody can impersonate anyone else's
agents. Create a members file on the relay (chmod 600):

```json
{ "members": [
    { "name": "alice", "token": "<openssl rand -hex 32>" },
    { "name": "bob",   "token": "sha256:<hex sha256 of bob's token>" } ] }
```

Run `palaver relay --members members.json` or set `PALAVER_MEMBERS`. A member may only use
the name `<member>` or names starting with `<member>-` (`alice-claude`, `alice-codex-2`).
The relay refuses member names that overlap, such as `alice` and `alice-bob`.
You can combine a members file with a shared `PALAVER_TOKEN`; token holders can use any name.
For separate teams, run separate relays. A relay is a single small process.

**Example swarm on one machine:**

```sh
palaver tmux alice-planner  --roles planner  -- claude
palaver tmux alice-codex-1  --roles backend  -- codex
palaver tmux alice-codex-2  --roles backend  -- codex
palaver tmux alice-reviewer --roles reviewer -- claude
```

Then tell the planner: *"split the task, send backend work to @backend, and send the result to @reviewer"*.

**Guard rails.** Each connection may send at most 30 messages per 10 seconds, so two agents
that keep replying to each other hit the limit instead of flooding everyone. Messages are
plain text up to 100,000 characters.

## CLI

```
palaver relay --host <ip> [--port 7777] [--members file.json]
palaver mcp
palaver tmux <name> [--roles a,b] -- <agent command...>
palaver list
palaver send <to> <message...>        # to: name, @role or @all; sends as $PALAVER_NAME without going online
palaver wait [seconds]                # goes online as $PALAVER_NAME and prints the next message
palaver listen <name> [seconds]       # waits on <name>'s local inbox (no relay connection)
```

Settings come from environment variables, otherwise from the first existing file of
`$PALAVER_ENV`, `~/.config/palaver/.env`, `<package>/.env`. See [.env.example](.env.example). In settings files,
double-quoted values decode JSON-style escapes (`\"`, `\\`, `\n`), single-quoted values are
literal, and an empty value counts as unset.

| Variable | Used by | Meaning |
|---|---|---|
| `PALAVER_RELAY` | peers | relay URL, `ws://host:7777` or `wss://` behind TLS |
| `PALAVER_TOKEN` | both | shared secret, or a member's own token |
| `PALAVER_NAME` | peers | this agent's peer name |
| `PALAVER_ROLES` | peers | comma-separated roles |
| `PALAVER_PUSH` | peers | `channel` or `listener`, overrides detection |
| `PALAVER_HOME` | peers | local state directory (default `~/.palaver`) |
| `PALAVER_HOST`, `PALAVER_PORT` | relay | listen address (required) and port (default 7777) |
| `PALAVER_MEMBERS` | relay | members file with per-member tokens |

## Security

palaver's job is to put text from one agent in front of another agent. Plan for that:

- **Anyone who holds a valid token can message your agents**, and agents running with
  relaxed permissions (`--dangerously-skip-permissions`, auto-approve) may act on it.
  Keep tokens secret, use per-member tokens for groups, and run the relay on a
  private network or VPN only.
- **Messages are labeled, not trusted.** Agents are told that palaver messages come from
  other agents, not from their user. Message text cannot close the channel tag or forge a
  message boundary. That is guidance for the model, not a sandbox.
- **Use TLS outside a trusted network.** The relay speaks plain `ws://`. Put it behind a
  VPN (WireGuard, Tailscale) or a TLS proxy, for example Caddy:
  `caddy reverse-proxy --from relay.example.com --to 127.0.0.1:7777`, then use
  `PALAVER_RELAY=wss://relay.example.com`.
- **tmux injection types into a live terminal.** The injector pastes only into the pane
  where it started the agent, never into another pane, and holds back while it recognizes an
  approval prompt on screen. That is best effort, based on what the screen shows; prefer
  agents that ask before risky actions over auto-approve modes. Anything you have half-typed in that pane is submitted together with the message.
- Local inboxes live in `~/.palaver/inbox/<name>/` (0700/0600). Every message holds the
  sender name the relay verified.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Limitations

- The relay keeps offline queues in memory; restarting the relay drops them.
- Delivery is at least once. "Delivered" means the receiving machine stored the message in
  the agent's inbox or pushed it into the session, not that the agent has acted on it. A message
  that was not confirmed is redelivered after the receiver reconnects, so in rare cases it
  arrives twice. A receiver gets at most 50 unconfirmed messages; more wait in its queue.
- Push depends on Claude Code channels (research preview); the flag name may change.
- No built-in TLS, persistence, message history or web UI, by design: the relay stays small.

## Roadmap

Ideas that fit the small-relay design, roughly in order:

- `palaver doctor`: check settings source, relay reachability, identity, delivery mode, inbox and injector
- message expiry (TTL) and reply-to ids for request/response automation
- token revocation and reload without restarting the relay; optional per-member send rules
- optional on-disk queue so a relay restart keeps undelivered messages
- a Claude Code plugin package, and `npx palaver-agents` once published to npm

## Development

```sh
npm install
npm test        # starts its own relay on a random port; tmux tests run when tmux is installed
```

`npm run test:e2e` is an opt-in end-to-end test with real agents. It starts a relay and two
Docker "machines" running Claude Code, Codex and Antigravity, then checks a roll call
(`@all`) and a baton passed through every agent across both machines. It needs Docker and
agent logins (`--use-local-logins` copies this machine's logins into the test containers
for the run; `CLAUDE_CODE_OAUTH_TOKEN` / `OPENAI_API_KEY` also work; see
[test/e2e/run.mjs](test/e2e/run.mjs)), uses your model subscriptions, and takes a few
minutes. It runs only on your machine, never in CI.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [Apache License 2.0](LICENSE).
