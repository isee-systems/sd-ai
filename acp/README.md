# ACP manifest

`GET /api/v1/acp/manifest` serves a manifest for client applications that run the user's own
ACP assistant (Claude Code, Codex, Gemini CLI, … — the user's installed CLI, on their own account)
in place of sd-ai's hosted agents. It tells the client which assistants it can offer and how to
launch each one, which of this repo's agents (Socrates, Merlin, Themis, Athena) it can load, and how
to stand in for the sd-ai tools those agents call. Clients fetch it periodically, so a deploy here
changes them without a client release.

It is rebuilt on every server start, and every 6 hours, from:

| Source | Becomes |
|---|---|
| `agent/config/*.md` | `personas` — edit an agent here and clients get it on the next deploy |
| ACP Registry (live; `registry-snapshot.json` if offline) | `agents`: the assistant table |
| `client.config.json` | which assistants are enabled (`enabledAgents`) and which the client may install (`installable`, `runtimes`), overrides, default agent, setting tooltips and defaults, permissions |
| `standInTools` + `agent/tools/builtin` | `standInTools`: the real definitions of the sd-ai tools the agents call, each with its stand-in recipe (`howToRespond`, `brief`, `include`, `acceptsImage`) — add a tool here and clients serve it with no client release |
| `engines/*` prompts | `engineBriefs`: what the client hands the user's assistant in place of sd-ai's engines (Seldon, mentor, runs comparison, LTM narrative, quantitative, qualitative) |

The serial is the build time, so each deploy supersedes the last (clients refuse older manifests).

## Protocol

Clients in the field outlive any deploy, so the manifest is versioned and the rules below are the
contract. Breaking them strands clients that cannot be updated from here.

**Request.** `GET /api/v1/acp/manifest?protocol=<n>&client=<id>&clientVersion=<version>`. `protocol`
is the manifest protocol the client speaks; a request without it is treated as protocol 1. `client`
and `clientVersion` name the client application, for cut-offs. The response carries the manifest, and
the protocol it is written in in `X-ACP-Protocol`.
The URL's `/v1/` versions the route itself; the manifest protocol is versioned separately, so the
route can stay put while the protocol moves on.

**Envelope — frozen forever.** Every manifest, in every protocol, has:

| Field | Meaning |
|---|---|
| `protocol` | the protocol the rest of the body is written in |
| `serial` | only ever grows; clients refuse a lower one than they already trust, so an old manifest cannot be replayed |
| `issuedAt` | ISO time |
| `compatibility` | `{ minProtocol, minClientVersions, message, url }` — the cut-off (below) |

Never rename, remove or change the meaning of these. A client reads them before it looks at
`protocol`, which is what lets the server reach clients it can no longer otherwise talk to.

**Evolving the body.**

- *Adding* a field, a section, an agent override, a stand-in recipe key or a provider needs no
  version change: clients ignore what they do not know. A stand-in whose recipe asks for a provider
  the client lacks still works, without that data.
- An entry (an agent, a persona, a stand-in tool) that would be *wrong* without a newer feature lists
  it in `"requires": [...]`, and clients without all of them leave the entry out. Client features are
  named for the recipe vocabulary: `standIn.howToRespond`, `standIn.brief`, `standIn.include`,
  `standIn.acceptsImage`, `include.loopDominance`, `include.behaviorFile`, `include.documents`,
  `include.sessionFolder`. Name new ones the same way.
- *Changing or removing* the meaning of something existing is a new protocol: bump `PROTOCOL` in
  `buildManifest.js`, add its builder to `BUILDERS`, and keep the old builder for as long as clients
  that speak it are supported. Each request is answered in the newest protocol the client speaks.

**Cutting clients off.** In `client.config.json`:

```json
"compatibility": {
  "minProtocol": 1,
  "minClientVersions": { "<client id>": "4.3" },
  "message": "shown to the user",
  "url": "https://where to update"
}
```

A client that speaks a protocol below `minProtocol`, or a build of a client older than its entry in
`minClientVersions`, offers none of the user's assistants and shows `message` and `url`. Because the
cut-off is in the envelope it reaches clients whatever protocol they speak, holds while they
are offline (they cache it), and cannot be undone by their bundled copy or a replayed older manifest.
Raising `minProtocol` above `PROTOCOL` switches every client off. Lowering a value un-cuts clients on
their next fetch. To switch off one assistant rather than whole clients, take it out of
`enabledAgents` (or override it with `"enabled": false` in `agentOverrides`).

**Which assistants are offered.** `enabledAgents` lists the ACP Registry ids clients offer; every other
registry entry is still in the manifest, switched off, so turning one on is a one-line change here.
Without the list every launchable entry is on.

**Installing an assistant for the user.** An agent listed in `installable` carries `install`: the
steps a client runs, when the user asks it to, to install that assistant into a folder of the
client's own (nothing system-wide). Clients run two generic kinds of step, and nothing
package-manager specific — so any agent, however it is distributed, is made installable here, with
no client release:

| kind | Fields | Does |
|---|---|---|
| `download` | `label`, `archives: {<registry target>: {url, sha256, bin}}`, `into` (`agent` or `runtime`), `name` + `version` (a runtime), `strip` | downloads the archive for the user's platform, refuses it unless its sha256 matches, unpacks it into the agent's install or a shared runtime folder (reused by every agent on it); `strip` removes a single top-level folder; `bin` goes on the install's PATH |
| `run` | `label`, `program`, `args`, `env`, `clearEnv`, `path`, `timeoutMinutes` | runs a program from inside the install — never a system program or a shell — on a PATH with the install's folders first, without the user's variables named in `clearEnv`; `path` names the folders it leaves programs in |

Templates may use `{agent}` (this install's folder), `{runtime:<name>}` (a runtime an earlier step
downloaded) and `{temp}` (scratch space, deleted after); between them, only the launch rules' safe
characters. `byPlatform: {mac|windows|linux: {...}}` replaces a step's fields on one platform.
`install.env` holds variables set when the assistant runs from that install. `checkInstall` applies
the clients' rules at build time, so a manifest never says something a client would refuse.

Generated today: an npx agent is node (`runtimes.node`, `strip`ped into a runtime) then npm
(`node npm-cli.js install --prefix {agent} <exact versions>` with the user's npm configuration
cleared); a binary agent is its own archive, unpacked as the registry lays it out. A uvx agent would
be uv's archive then `uv tool install` with `UV_*` pointed into `{agent}` — a generator here, not a
client change. Listed: Claude (`claude-agent-acp` plus Claude Code), Codex and Copilot (npm, on
Node), and Antigravity (its archive).

**Always up to date, with nothing pinned by hand.** Every build (on start, then every 6 hours)
works out what moves on before it replaces the manifest being served (`resolveInstalls`), so a new
release never makes an install drop out:

- the agents themselves: the registry's current version (npm packages are exact in the registry);
- companion packages that follow their agent: Claude Code is the version the adapter's Agent SDK
  was made for (`claudeCodeVersion`), via `extraPackages: [{package, versionFrom, fallback}]`;
- tracked runtimes: Node moves to the newest release of `track.major`, with checksums from that
  release's `SHASUMS256.txt`;
- archives the registry gives no checksum for (Antigravity's): the server downloads each new url
  once and hashes it (cached in `ACP_ARCHIVE_HASH_CACHE`, default the temp folder). A hash pinned
  in `installable.<id>.sha256` still wins, and one that disagrees drops that target.

What cannot be reached keeps the configured values (`version`/`archives`, `fallback`), which is also
what offline builds (`--offline`, the client's bundled copy) use. An installable agent that still
ends up with no install is logged as a warning. The first build after a deploy does not wait for
archives to be hashed (nothing would be served meanwhile); it is built again once they are. When the
manifest's steps for an agent a client installed change, the client asks the user whether to update
it (or, if they turned on updating automatically, updates it in the background).
`claudeCodeVersion` is read from the Agent SDK version npm would install, and when the adapter gives
the SDK only as a range, that SDK version is pinned in the install beside Claude Code.

**What the manifest sets on the assistants.** It hides none of their choices, and leaves their
settings to the user, with one exception: the main assistants (Claude, Codex, Copilot, Antigravity)
start in a mode that asks less (`agentOverrides.<id>.configDefaults`): Claude `auto` and Codex
`agent` (auto review) decide for themselves what is safe to run without asking, Copilot `autopilot`
runs commands without asking, and Antigravity `auto_edit` edits files without asking but still asks
before running a command (its only mode that never asks, `yolo`, approves everything) -- so a modeling
session is not a stream of permission prompts. A mode the user picks in the client always wins, and
other assistants start as the user configured them. `configOptions.defaults` (the same for every
assistant) and `configOptions.hide` stay empty; the tests check all of this.

**No sd-ai AI tokens are ever spent for these clients.** Building the manifest only reads prompt
text and tool schemas from this repo (its only network access is the ACP Registry and npm metadata),
and a stand-in never calls sd-ai: the client gathers the inputs locally and the user's own assistant,
on the user's own account, does the work an sd-ai engine would have done.

## Signing

The manifest is not signed, and won't be: clients rely on HTTPS to the server they trust to know a
manifest is genuine. Serve it over HTTPS only. A client should warn its user before using a manifest
from any other server (or over plain HTTP), since the manifest decides which programs the client
launches; clients still refuse an agent whose command is a shell, an interpreter or a package runner.

## Commands

- `npm run acp:manifest -- --out acp_manifest.json` — build. A client's bundled fallback copy is
  made this way (add `--offline` to build from the committed snapshot); regenerate it rather than
  editing it by hand, so the server and the bundled copy agree.
- `npm run acp:snapshot` — refresh `registry-snapshot.json` from the live registry; commit it.
