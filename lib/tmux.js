// Run an interactive CLI agent (Codex, Claude Code, ...) inside tmux and paste
// incoming palaver messages into it, so an idle session wakes up and answers.
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { BIN, checkName, parseRoles } from "./config.js";
import * as inbox from "./inbox.js";

const tmux = (args, input) => execFileSync("tmux", args, { encoding: "utf8", input, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Prompts where Enter would answer a question instead of submitting our text.
// Matched only against the bottom of the screen, where agents draw these prompts.
export const APPROVAL_RE =
  /Do you want to (proceed|make this edit|run|create|allow)|Would you like to (run|make|apply|allow)|Allow (command|this|once)\b|\((y\/n|Y\/n|y\/N)\)|\[(y\/n|Y\/n|y\/N)\]|Yes, (and )?don't ask|Yes, allow|[❯›>]\s*1\.\s*(Yes|Trust|Allow|Approve)|Press enter to confirm|Enter to confirm|trust this folder|Trust the files/i;
const PROMPT_LINES = 12;

// Settings handed to the agent and the injector. Never the token: it would be
// visible in process lists. The agent's MCP server reads it from a settings file.
const FORWARD = ["PALAVER_RELAY", "PALAVER_HOME", "PALAVER_ENV", "PALAVER_PUSH"];

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
  if (!cmd.length) throw new Error("usage: palaver tmux <peer-name> [--roles a,b] -- <agent command...>");
  if (!tmuxVersionOk()) throw new Error("tmux 3.2 or newer is required (install it, e.g. `brew install tmux` or `apt install tmux`)");
  const session = sessionFor(name);
  if (spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0) {
    throw new Error(`tmux session ${session} already exists: attach with \`tmux attach -t ${session}\`, or end it with \`tmux kill-session -t ${session}\``);
  }
  if (process.env.PALAVER_TOKEN && !process.env.PALAVER_TOKEN_FROM_FILE) {
    console.error("palaver: note: a PALAVER_TOKEN set only in the shell is not passed to the agent; put it in a settings file (see `palaver help`).");
  }
  const env = { PALAVER_NAME: name, PALAVER_ROLES: roles };
  for (const k of FORWARD) if (process.env[k]) env[k] = process.env[k];

  cmd = [...cmd];
  // Interactive Codex starts MCP servers from a shared app-server daemon that does not
  // inherit this environment, so pass the same settings as a config override.
  if (/(^|\/)codex$/.test(cmd[0])) {
    const table = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
    cmd.splice(1, 0, "-c", `mcp_servers.palaver.env={${table}}`);
  }
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  // When the agent exits, end the whole session so the injector goes with it.
  const agentCmd = `${cmd.map(q).join(" ")}; tmux kill-session -t ${q(`=${session}`)}`;
  const pane = tmux(["new-session", "-d", "-P", "-F", "#{pane_id}", "-s", session, "-n", "agent", "-c", process.cwd(), ...envArgs, agentCmd]).trim();
  tmux(["new-window", "-d", "-t", `=${session}`, "-n", "injector", ...envArgs, `${q(process.execPath)} ${q(BIN)} inject ${q(name)} ${q(pane)}`]);
  const attach = process.env.TMUX ? ["switch-client", "-t", `=${session}`] : ["attach", "-t", `=${session}`];
  const r = spawnSync("tmux", attach, { stdio: "inherit" });
  if (r.status !== 0) console.error(`palaver: session ${session} is running; attach with: tmux attach -t ${session}`);
}

/** The injector loop: paste messages for `name` into exactly the pane `pane` (e.g. "%3"). */
export async function inject(name, pane) {
  checkName(name);
  if (!/^%\d+$/.test(pane || "")) throw new Error("usage: palaver inject <name> <tmux pane id>");
  const paneAlive = () => {
    try {
      return tmux(["display-message", "-p", "-t", pane, "#{pane_id}"]).trim() === pane;
    } catch {
      return false;
    }
  };
  const approvalVisible = () => {
    try {
      const lines = tmux(["capture-pane", "-p", "-t", pane]).replace(/\s+$/, "").split("\n");
      return APPROVAL_RE.test(lines.slice(-PROMPT_LINES).join("\n"));
    } catch {
      return true; // cannot see the screen: do not type
    }
  };
  console.log(`palaver injector: pasting messages for "${name}" into pane ${pane}`);

  // Messages stay in the inbox until they are pasted; if the agent is gone they remain for read_inbox.
  while (paneAlive()) {
    const file = inbox.peek(name);
    if (!file) {
      await sleep(250);
      continue;
    }
    if (approvalVisible()) {
      await sleep(2000); // never press Enter on an approval prompt
      continue;
    }
    const c = inbox.claim(name, file);
    if (!c) continue;
    if (!c.msg) {
      c.commit(); // unreadable entry
      continue;
    }
    const m = c.msg;
    // Keep newlines and tabs (pasted as text), drop other control characters.
    const body = m.text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    const payload = `${inbox.format({ ...m, text: body })}\nReply with the palaver send_message tool, to="${m.from}". ${inbox.NOT_YOUR_USER}`;
    const buffer = `palaver-${crypto.randomBytes(4).toString("hex")}`;
    try {
      tmux(["load-buffer", "-b", buffer, "-"], payload);
      tmux(["paste-buffer", "-d", "-p", "-b", buffer, "-t", pane]); // -p: bracketed paste, newlines don't submit
      await sleep(400);
      tmux(["send-keys", "-t", pane, "Enter"]);
      c.commit();
      console.log(new Date().toISOString(), "pasted message from", m.from);
    } catch (e) {
      c.release();
      spawnSync("tmux", ["delete-buffer", "-b", buffer]);
      console.error(new Date().toISOString(), "tmux error, retrying:", String(e.message).trim());
      await sleep(2000);
    }
    await sleep(1000);
  }
  console.log("palaver injector: agent pane is gone; undelivered messages stay in the inbox");
}
