// Run an interactive CLI agent (Codex, Claude Code, ...) inside tmux and paste
// incoming palaver messages into it, so an idle session wakes up and answers.
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { BIN, checkName, parseRoles } from "./config.js";
import * as inbox from "./inbox.js";

const tmux = (args, input) => execFileSync("tmux", args, { encoding: "utf8", input, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Screens where pressing Enter would answer a question instead of submitting our text.
const APPROVAL_RE =
  /Do you want to (proceed|make this edit|run|create|allow)|Allow (command|this|once)|Approve|approval|\(y\/n\)|\[y\/N\]|\[Y\/n\]|Yes, (and )?don't ask|Yes, allow|❯\s*1\.\s*Yes|Press enter to confirm|Enter to confirm|trust (this|the files)/i;

export const sessionFor = (name) => `palaver-${name}`;

function tmuxVersionOk() {
  const v = spawnSync("tmux", ["-V"], { encoding: "utf8" }).stdout || "";
  const m = v.match(/(\d+)\.(\d+)/);
  return m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 2));
}

/** `palaver tmux <name> [--roles a,b] -- <command...>` */
export function launch(name, cmd, rolesValue = "") {
  checkName(name);
  const roles = parseRoles(rolesValue).join(",");
  if (!cmd.length) throw new Error("usage: palaver tmux <peer-name> -- <agent command...>");
  if (!tmuxVersionOk()) throw new Error("tmux 3.2 or newer is required (install it, e.g. `brew install tmux` or `apt install tmux`)");
  const session = sessionFor(name);
  if (spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0) {
    throw new Error(`tmux session ${session} already exists: attach with \`tmux attach -t ${session}\`, or end it with \`tmux kill-session -t ${session}\``);
  }
  cmd = [...cmd];
  // Interactive Codex starts MCP servers from a shared app-server daemon that does not
  // inherit this environment, so pass the peer name as a config override as well.
  if (/(^|\/)codex$/.test(cmd[0])) cmd.splice(1, 0, "-c", `mcp_servers.palaver.env={PALAVER_NAME="${name}", PALAVER_ROLES="${roles}"}`);

  // When the agent exits, end the whole session so the injector goes with it.
  const agentCmd = `${cmd.map(q).join(" ")}; tmux kill-session -t ${q(`=${session}`)}`;
  tmux(["new-session", "-d", "-s", session, "-n", "agent", "-c", process.cwd(), "-e", `PALAVER_NAME=${name}`, "-e", `PALAVER_ROLES=${roles}`, agentCmd]);
  tmux(["new-window", "-d", "-t", `=${session}`, "-n", "injector", `${q(process.execPath)} ${q(BIN)} inject ${q(name)}`]);
  const attach = process.env.TMUX ? ["switch-client", "-t", `=${session}`] : ["attach", "-t", `=${session}`];
  const r = spawnSync("tmux", attach, { stdio: "inherit" });
  if (r.status !== 0) console.error(`palaver: session ${session} is running; attach with: tmux attach -t ${session}`);
}

/** The injector loop (runs in the session's "injector" window). */
export async function inject(name) {
  checkName(name);
  const target = `=${sessionFor(name)}:agent`;
  const alive = () => spawnSync("tmux", ["has-session", "-t", `=${sessionFor(name)}`]).status === 0;
  console.log(`palaver injector: pasting messages for "${name}" into ${target}`);

  for (;;) {
    const msgs = await inbox.waitFor(name, 3600_000);
    while (msgs.length) {
      if (!alive()) {
        inbox.restore(name, msgs); // keep them for read_inbox
        return;
      }
      let screen = "";
      try {
        screen = tmux(["capture-pane", "-p", "-t", target]); // visible screen only
      } catch {}
      if (APPROVAL_RE.test(screen)) {
        // Never press Enter on an approval prompt; wait until it is answered.
        await sleep(2000);
        continue;
      }
      const m = msgs[0];
      // Keep newlines and tabs (pasted as text), drop other control characters.
      const body = m.text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
      const payload = `${inbox.format({ ...m, text: body })}\nReply with the palaver send_message tool, to="${m.from}". ${inbox.NOT_YOUR_USER}`;
      const buffer = `palaver-${crypto.randomBytes(4).toString("hex")}`;
      try {
        tmux(["load-buffer", "-b", buffer, "-"], payload);
        tmux(["paste-buffer", "-d", "-p", "-b", buffer, "-t", target]); // -p: bracketed paste, newlines don't submit
        await sleep(400);
        tmux(["send-keys", "-t", target, "Enter"]);
        msgs.shift();
        console.log(new Date().toISOString(), "pasted message from", m.from);
      } catch (e) {
        console.error(new Date().toISOString(), "tmux error, retrying:", e.message.trim());
        await sleep(2000);
      }
      await sleep(1000);
    }
  }
}
