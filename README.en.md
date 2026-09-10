# dsh-memoir-sqlite

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[中文](./README.md) · English · [Changelog](./CHANGELOG.md)

**A SQLite-backed, cross-session project-memory plugin for DeepSeek Harness (DSH).** It curates lasting preferences, verified lessons, and user-approved reusable workflows, also supports explicitly requested records, injects bounded cache-friendly Hot Memory into new sessions, and retrieves long-tail history through CJK-aware local BM25 ranking.

This project is forked from [`dsh-memoir`](https://github.com/Qinling-Melon-Farmers/dsh-memoir). It preserves automatic distillation, Hot Memory, CJK BM25, lifecycle management, and the native Web GUI while replacing the structured source of truth with Node's built-in `node:sqlite`. It needs no ORM, embeddings, vector database, or cloud memory service.

> [!IMPORTANT]
> The current source targets `@deepseek-ai/dsh >=0.1.2-alpha.2 <0.1.3`. It exposes the same tools and UI identifiers as upstream `dsh-memoir`; do not enable both in one profile.

Build from source and install through `link:` or a tarball as shown below. Memory remains local and is not automatically deleted when the plugin is updated or removed.

## Why dsh-memoir

| Capability | What you get |
| --- | --- |
| Local-first storage | A SQLite source of truth plus per-project `PROJECT_MEMORY.md` projections; no memory upload or external service |
| Automatic distill reminder | Reminds the top-level agent after a worked turn, then persists transparently through `memoir_record`; skips idle, aborted, subagent, and already-recorded turns |
| Bounded Hot Memory | Only high-value memory enters the system prompt under a hard token limit; a frozen session prefix improves prompt-prefix cache hits |
| BM25 ranked recall | Searches Chinese phrases, English keywords, code identifiers, and paths; cross-project Top-K and query LRU caching use one engine |
| Governable memory | Importance, pinning, tags, archive/restore, and supersede lifecycle; similar writes require an explicit update, replacement, or keep-both decision |
| Provenance | Agent writes retain trusted session/turn sources; the Web panel can copy and make a best-effort jump to the original session |
| Complete Web GUI | Bilingual project/global browsing, ranked search, editing, Hot Memory inspection, diagnostics, and live settings, with an independent agent-facing language choice |

It fits personal and local development workflows where a new agent should continue understanding a project. It is not a raw chat backup, multi-user cloud sync service, or vector-semantic knowledge base.

![dsh-memoir v0.6.1 global memory grouped and collapsed by project](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-global-project-groups-zh.png)

## How it works

```text
worked turn
    │  automatic distill reminder
    ▼
memoir_record / memoir_update
    │
    ├── $DSH_HOME/dsh-memoir-sqlite/memory.db  complete structured history (SSOT)
    ├── <project>/PROJECT_MEMORY.md   readable, committable projection
    └── Retrieval Index              inverted index + BM25 + query cache
              │
              ├── Hot Memory Selector ──> bounded system-prompt injection
              └── memoir_read / Web ────> on-demand long-tail recall
```

SQLite stores projects, entries, versions, and mutation audit rows; `PROJECT_MEMORY.md` is a readable projection. Complete history and Hot Memory are separate layers:

- **Full Memory** retains every record for the GUI, human review, Markdown projection, and ranked retrieval.
- **Hot Memory** selects only budgeted actions, lessons, and recent state; the full `PROJECT_MEMORY.md` is never injected.
- **Session Snapshot** freezes injected text within a session. New writes are immediately readable by tools and the GUI, while automatic injection refreshes in the next new session.

## Agent tools and memory lifecycle

| Tool | Purpose |
| --- | --- |
| `memoir_record` | Write work / lessons / actions / note entries; returns explainable similar/conflicting candidates before mutation |
| `memoir_update` | Preserve id and creation time while updating content, section, importance, tags, and lifecycle |
| `memoir_read` | Local ranked recall across project (default) / global / all with compact or full output |

Each entry has importance 1–5. The default, **3**, is neutral; pinning adds separate Hot Memory weight. Recall defaults to `active`. Archived or superseded history remains inspectable and restorable and is never deleted automatically.

Similar-memory governance starts with BM25 candidates, then combines title similarity and Token Jaccard. The plugin surfaces suspected duplicates or conflicts but does not decide truth on its own. The caller must choose:

- `update`: update an existing record in place;
- `supersede`: retain old history and mark it as replaced by the new record;
- `force-record`: explicitly keep both.

## Automatic distillation

Automatic distillation is an observable review of lasting value, not an automatic work log or silent background scraping. The default `1 / 0 / 1` means every eligible worked turn, no extra cooldown, and at least one tool call; a reminder does not require a write.

Automatic admission is limited to explicit long-term user preferences and constraints, verified reusable lessons not covered by existing rules, and user-approved workflows with future reuse. Task progress, Job IDs, delivery paths, generation timings, temporary choices, pending authorization, to-dos, and routine results remain in conversation and task records; one choice does not establish a lasting preference. Candidates must remain useful across tasks and add to existing documentation or memory. When uncertain, do not write. Assess value before looking up duplicates; prefer updating confirmed corrections.

Explicit requests to remember something are honored only within the requested scope, including task-specific content. Existing `work / lessons / actions / note` categories and manual editing remain supported; old memory is neither migrated nor cleaned up. Consistent system guidance, turn-end reminders, and tool descriptions guide admission, rather than a database-level semantic filter. Cadence controls review timing only. Plugin updates require a host reload, and frozen prompt snapshots refresh in a new session.

`autoDistillEvery`, `autoDistillCooldownMin`, and `autoDistillMinTools` are AND conditions isolated per agent. Idle, aborted, subagent, and already-recorded turns do not trigger. Cooldown advances only after a successful reminder. All cadence parameters are live-editable in the GUI.

`language` independently controls agent-visible tool descriptions and parameters, the distillation prompt, tool results, Hot Memory / `PROJECT_MEMORY.md` headings, and validation or governance errors. It defaults to `zh` for backward compatibility and can be switched to `en` in the GUI. Tool schemas and subsequent prompts update live without restarting DSH.

## Local recall and caching

- Chinese 2/3-grams, English words, and code/path identifier tokenization;
- document-side BM25 keeps true term frequency, with a 2.5× title boost plus exact-phrase, section, and recency weighting;
- separate title/body length normalization;
- deduplicated global Top-K shared by project / global / all;
- epoch-aware LRU query cache with one-hour time buckets; `limit` and output detail stay outside the key so output shapes share rankings;
- the GUI and `memoir_read` use the same RetrievalEngine and expose hits, misses, evictions, hit rate, and last-query latency.

Top-5 recall on the fixed quality set is 100%; the repository gate requires at least 90%.

## Web GUI

Installing into a DSH-alpha `web` profile registers a native Memory Conversation view and Memory Settings section through official slots. The DSH shell owns layout, navigation, and unload lifecycle; Memoir no longer takes over the legacy sidebar through DOM selectors.

- Project memory and all-project global memory, with project groups collapsed by default and complete lifecycle totals;
- status, section, and keyword filters with BM25 scores;
- add, edit, pin, archive, restore, and supersede;
- copy and best-effort navigation for session/turn provenance;
- Hot Memory Inspector: what the next session will inherit;
- Retrieval Diagnostics: index, query cache, last query, and session snapshot;
- permanent `Browse / Settings / Hot Memory / Diagnostics` navigation with an independent bounded scroll position per surface;
- progressive batches of 20 entries or projects, plus a controlled six-line preview for long memory bodies;
- the native DSH composer-overlay contract, keeping the final memory visible above the conversation composer while the list scrolls fully;
- arrow-key, Home, and End navigation for surface tabs, plus `aria-expanded` project disclosures and visible focus states;
- live GUI Chinese/English switching from `<html lang>`, with a separate `language` setting for agent-facing copy.

<details>
<summary>More GUI screenshots</summary>

![v0.6.1 permanent surface navigation and live settings](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-settings-navigation-zh.png)

![v0.6.1 conversation view scrolled to the end above the composer](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-conversation-scroll-zh.png)

![Native Memory Conversation view on DSH alpha.2](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.0/picture/v0.6.0-alpha2-native-zh.png)

![Memory lifecycle and similar-memory governance](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.4-memory-management-zh.png)

![Settings card](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.6-settings-card-zh.png)

![Sidebar parity](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.5-sidebar-parity-zh.png)

</details>

## Installation and compatibility

Node.js `^22.19.0 || >=24.0.0` and DSH `>=0.1.2-alpha.2 <0.1.3` are required. The source uses pnpm:

```bash
git clone https://github.com/choco9527/dsh-memoir-sqlite.git
cd dsh-memoir-sqlite
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:/absolute/path/dsh-memoir-sqlite"
```

Restart the target DSH profile. You can also run `pnpm pack` and have an app build install the resulting tarball.

## Storage, privacy, and security boundaries

```text
$DSH_HOME/dsh-memoir-sqlite/memory.db     SQLite source of truth, versions, and audit
$DSH_HOME/dsh-memoir-sqlite/settings.json live GUI setting overrides
<project>/PROJECT_MEMORY.md                human-readable projection generated from SQLite
```

- No cloud memory database, embedding API, or vector database;
- an arbitrary absolute path submitted by the browser does not grant write access; panel writes accept only a trusted active workspace or an existing project bucket;
- manual browser records cannot spoof trusted session/turn provenance;
- SQLite uses WAL, while an exclusive lock protects the complete cross-process read-modify-commit sequence;
- inserts, updates, and deletes append to `entry_revisions`, and entry versions increase monotonically;
- Windows path keys are case-normalized while display paths retain their original form;
- `PROJECT_MEMORY.md` may be committed by you, so the user decides whether sensitive content enters Git.

On the first default-path start, an empty database automatically imports `$DSH_HOME/dsh-memoir.json`. Store callers can also import another legacy file explicitly. Import never modifies the source JSON. Back up the database, legacy JSON, and project Markdown before upgrades. Removing the plugin does not actively delete them.

## Configuration

Every field below can be set in the memoir `config` row in `cordis.patch.yml`. Except for `enabled` and `showConversationView`, each is also live-editable and persisted from the Memory panel or Settings card.

| Field | Default | Purpose |
| --- | ---: | --- |
| `enabled` | `true` | master switch for tools, routes, and prompt injection |
| `showConversationView` | `true` | register the per-conversation Memory view; the Settings section always remains available |
| `language` | `zh` | agent-facing prompt, tool schema/result, projection-heading, and error language; `zh` or `en` |
| `announceToAgent` | `true` | announce memory tools and rules to the agent |
| `autoDistill` | `true` | enable top-level worked-turn reminders |
| `autoDistillEvery` | `1` | remind at most once per N worked turns |
| `autoDistillCooldownMin` | `0` | minimum minutes between successful reminders |
| `autoDistillMinTools` | `1` | minimum tool calls required in a triggering turn |
| `hotMemoryTokens` | `900` | normal Hot Memory target budget |
| `hotMemoryMaxTokens` | `1200` | hard ceiling that no session exceeds |
| `readDefaultLimit` | `8` | default `memoir_read` result count |
| `readMaxLimit` | `30` | live upper bound per recall |
| `sessionSnapshotMax` | `128` | frozen session-snapshot LRU capacity |
| `queryCacheSize` | `128` | BM25 query LRU capacity |

Shrinking a cache evicts the oldest entries immediately. Existing frozen sessions are not rewritten after budget changes, preserving prompt-prefix stability. “Restore startup configuration” removes Web overrides and returns to profile startup values.

## Performance and verification

The fork retains upstream's bounded Hot Memory, query cache, and CJK BM25 quality corpus. It adds tests for the SQLite schema, WAL, file permissions, versioned audit history, corrupt-database preservation, cross-connection visibility, and legacy JSON import. The historical JSON-store benchmark remains in [`bench/report.md`](./bench/report.md); SQLite persistence will be rebenchmarked before release so old numbers are not presented as current results.

## FAQ

**Does it automatically summarize every chat?**<br>
No. Eligible turns prompt a review of lasting value only; with no qualified candidate, no memory tools are called. Writes use public tools and remain observable and reviewable.

**Why does every new memory start at importance 3?**<br>
Three is the neutral default on a 1–5 scale, so unscored content is neither demoted nor treated as highest priority. Change it through tool arguments or the GUI; pinning has separate weight.

**Why is a new write not reinjected immediately in the current session?**<br>
The session Hot Memory snapshot is deliberately frozen for prompt-prefix caching. The write is immediately visible to `memoir_read` and the GUI, and the next session rebuilds automatic injection.

**Does it inject all stored memory into context?**<br>
No. Only Hot Memory bounded by `hotMemoryMaxTokens` is injected automatically. Complete history is recalled on demand.

**Why is the UI missing after installation?**<br>
Confirm the command used `--profile web`, then fully restart `dsh web`. Refreshing the browser alone is not enough.

## Development and contributing

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm run bench
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting changes and [CHANGELOG.md](./CHANGELOG.md) for version history. This fork is based on upstream `dsh-memoir@0.6.1`; the Apache-2.0 license and original copyright notice remain intact.

Apache-2.0
