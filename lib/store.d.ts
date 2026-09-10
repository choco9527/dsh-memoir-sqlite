/**
 * Structured memory store for dsh-memoir-sqlite. SQLite is the source of
 * truth; per-project PROJECT_MEMORY.md files are regenerated human-readable
 * projections. The in-memory shape remains stable for retrieval and UI code.
 */
import type { MemoirLanguage, MemoirLanguageSource } from './i18n.js';
/** Global index format version. */
export declare const FORMAT_VERSION = 4;
/** Project memory file name (workspace root, git-committable). */
export declare const PROJECT_FILE = "PROJECT_MEMORY.md";
/** Section keys, human labels, and markdown headers (fixed order for rendering). */
export declare const SECTIONS: Record<SectionKey, {
    label: string;
    header: string;
}>;
/** Section keys in canonical render order. */
export declare const SECTION_KEYS: SectionKey[];
/**
 * Legacy cap on how much project memory was auto-injected into the prompt,
 * in JS string length (not bytes, not tokens). Kept for compatibility with
 * existing imports; v0.4+ replaces this with the selector's token budget
 * (targetTokens / hardMaxTokens).
 */
export declare const INJECT_LIMIT = 16000;
export type SectionKey = 'work' | 'lessons' | 'actions' | 'note';
/** Lifecycle state for one memory entry (v0.5.0). */
export type MemoirStatus = 'active' | 'superseded' | 'archived';
export declare const MEMOIR_STATUSES: MemoirStatus[];
/** Trusted origin of one memory entry (v0.5.6 / store format v4). */
export interface MemoirSource {
    /** DSH session / agent id that produced the memory. */
    sessionId?: string;
    /** DSH turn number containing the memoir_record call. */
    turnId?: number;
}
/** One structured memory entry. */
export interface MemoirEntry {
    id: string;
    section: SectionKey;
    title?: string;
    content: string;
    time: number;
    /** Last content or lifecycle update time. */
    updatedAt?: number;
    /** Monotonic entry revision, starting at 1. */
    version?: number;
    source?: MemoirSource;
    importance?: number;
    pinned?: boolean;
    status?: MemoirStatus;
    supersedes?: string[];
    tags?: string[];
}
/** One project's bucket in the global index. */
export interface MemoirProject {
    path: string;
    title: string;
    updatedAt: number;
    entries: MemoirEntry[];
}
/** The persisted store file shape. */
export interface MemoirStoreFile {
    version: number;
    projects: Record<string, MemoirProject>;
}
/** A record payload accepted from tools and the panel API. */
export interface EntryPayload {
    section: SectionKey;
    title?: string;
    content: string;
    importance?: number;
    pinned?: boolean;
    supersedes?: string[];
    tags?: string[];
}
/** Mutable fields for an existing memory entry (v0.5 lifecycle). */
export interface EntryUpdate {
    section?: SectionKey;
    /** Empty string or null removes the title. */
    title?: string | null;
    content?: string;
    importance?: number;
    pinned?: boolean;
    status?: MemoirStatus;
    supersedes?: string[];
    tags?: string[];
}
/** An in-memory snapshot of the store at one revision. */
export interface StoreSnapshot {
    /** Write revision this snapshot reflects (bumped only by save()). */
    revision: number;
    /** Snapshot epoch: bumped on every snapshot (re)build — external changes
     *  and first loads included — so consumers can key caches on it. */
    epoch: number;
    /** The parsed (normalized) store file. */
    file: MemoirStoreFile;
    /** SQLite data_version observed when the snapshot was built. */
    dataVersion: number;
}
/** Cache/IO counters exposed for diagnostics and cache-hit-rate tests. */
export interface CacheStats {
    /** Current write revision (bumped by record/remove). */
    revision: number;
    /** Current snapshot epoch (bumped on every snapshot (re)build). */
    epoch: number;
    /** Total load() calls. */
    loads: number;
    /** Warm reads served straight from the snapshot (no file read). */
    hits: number;
    /** Cold reads / rebuilds that consulted the file. */
    misses: number;
    /** hits / loads, in [0, 1]. */
    hitRate: number;
    /** Full database snapshot reads since construction. */
    fileReads: number;
    /** SQLite data_version probes issued against the store. */
    statProbes: number;
    /** Corrupt database files preserved before recovery. */
    corruptBackups: number;
    /** renderMarkdown() calls. */
    renders: number;
    /** Actual markdown recomputations. */
    renderComputes: number;
    /** (renders - renderComputes) / renders, in [0, 1]. */
    renderHitRate: number;
    /** Duration of the last cold load in milliseconds. */
    lastLoadMs?: number;
}
/** How often warm load() calls probe SQLite data_version; 0 = every call. */
export declare const DEFAULT_MTIME_CHECK_MS = 2000;
/** Default store location under $DSH_HOME (fallback ~/.dsh). */
export declare function defaultStorePath(): string;
/** Cross-process mutation lock defaults (roadmap §2.2). */
export declare const DEFAULT_LOCK_RETRY_MS = 25;
export declare const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export declare const DEFAULT_LOCK_STALE_AFTER_MS = 60000;
/**
 * Run fn while holding an exclusive lock file created with openSync('wx')
 * (atomic O_EXCL create, no race window). Retries every retryMs until
 * timeoutMs, then throws. The lock is always released in finally — even
 * when fn throws. Used to serialize read-modify-write store mutations
 * across processes sharing one memoir SQLite database.
 */
export declare function withFileLock<T>(lockPath: string, fn: () => T, options?: {
    retryMs?: number;
    timeoutMs?: number;
    staleAfterMs?: number;
}): T;
/** `YYYY-MM-DD HH:mm` in local time. */
export declare function formatTime(ms: number): string;
/**
 * Normalize one workspace path into a stable key:
 * strip trailing separators, unify separators to '/'. Windows drive paths
 * are FULLY lowercased (v0.4.2) — the canonical bucket key of C:\A /
 * c:\a\ / C:/A is 'c:/a', so all case variants share one bucket. The
 * display path stored on the project keeps its original case. POSIX paths
 * are unchanged apart from trailing separators.
 */
export declare function projectKey(cwd: string): string;
/** Project display title: the last path segment. */
export declare function projectTitle(cwd: string): string;
/** Atomic write (unique tmp name + rename), creating the parent dir. */
export declare function writeFileAtomic(path: string, content: string, mode?: number): void;
/** Trim a long text to a bounded tail for prompt injection. */
export declare function bounded(value: string, limit: number): string;
/** Validate one record payload; returns an error message or undefined. */
export declare function validateEntryPayload(payload: unknown, language?: MemoirLanguage): string | undefined;
/** Validate a partial update without requiring the immutable record fields. */
export declare function validateEntryUpdate(payload: unknown, language?: MemoirLanguage): string | undefined;
/**
 * The structured memory store.
 */
export declare class MemoirStore {
    /** The SQLite database path. */
    readonly path: string;
    /** How often warm load() calls re-probe SQLite data_version. */
    readonly mtimeCheckIntervalMs: number;
    /** Cross-process mutation lock retry interval (withFileLock). */
    readonly lockRetryMs: number;
    /** Cross-process mutation lock acquisition timeout (withFileLock). */
    readonly lockTimeoutMs: number;
    /** Cross-process stale lock reclaim threshold. */
    readonly lockStaleAfterMs: number;
    /** The in-memory snapshot backing warm reads. */
    private snapshot;
    /** Write counter; bumped on every save() (record/remove). */
    private revision;
    /** Snapshot-rebuild counter; bumped on every snapshot (re)build. */
    private epoch;
    /** Timestamp of the last data-version probe. */
    private lastMtimeCheck;
    /** Open SQLite persistence connection. */
    private readonly database;
    /** Legacy JSON imported once when the default SQLite database is empty. */
    private readonly legacyJsonPath;
    private loadCount;
    private hitCount;
    private fileReadCount;
    private statProbeCount;
    private lastLoadMs;
    /** renderMarkdown cache: project key → { signature, markdown }. */
    private renderCache;
    private renderCount;
    private renderComputeCount;
    private readonly languageSource;
    /**
     * @param path - SQLite database path (defaults to the standard location).
     * @param options.mtimeCheckIntervalMs - data-version probe throttle; 0 probes on
     *   every load (tests), defaults to a low-frequency 2000ms.
     * @param options.lockRetryMs / lockTimeoutMs - cross-process mutation lock
     *   tuning (tests shrink these; defaults 25ms / 5000ms).
     */
    constructor(path?: string, options?: {
        mtimeCheckIntervalMs?: number;
        lockRetryMs?: number;
        lockTimeoutMs?: number;
        lockStaleAfterMs?: number;
        language?: MemoirLanguageSource;
        legacyJsonPath?: string | false;
    });
    /** Current model-facing language (live when backed by Web settings). */
    language(): MemoirLanguage;
    /** The cross-process lock file guarding mutations of this store. */
    private lockFilePath;
    /**
     * Run one read-modify-write mutation inside the cross-process lock.
     * Inside the critical section the in-memory snapshot is dropped and the
     * store is re-read from SQLite, so a process whose snapshot went stale
     * mutates the latest committed state.
     */
    private mutateLocked;
    /** Current store revision (0 before the first load/save). */
    currentRevision(): number;
    /**
     * Load the relational store into the stable structured representation.
     * Warm reads use the in-memory snapshot; throttled PRAGMA data_version
     * probes detect commits made by another DSH process.
     */
    load(): MemoirStoreFile;
    /** Normalize a parsed store file: mint ids, coerce shapes, merge duplicate
     *  buckets that normalize to the same project key (legacy Windows variants). */
    private normalize;
    /** Parse and normalize one legacy dsh-memoir JSON store. */
    private readLegacyJson;
    /** Import a legacy JSON store and merge entries by id. */
    importLegacyJson(path: string): number;
    /** Persist the store in one SQLite transaction. */
    save(file: MemoirStoreFile): void;
    /** Drop the snapshot so the next load() re-reads and re-parses the file. */
    invalidate(): void;
    /** Cache/IO counters (diagnostics + tests). */
    stats(): CacheStats;
    /** Close the SQLite connection. */
    close(): void;
    /** One project record, or undefined. */
    project(cwd: string): MemoirProject | undefined;
    /** Entries of one project in insertion order. */
    entries(cwd: string): MemoirEntry[];
    /** Compact per-project summaries (path, title, entry count, updatedAt). */
    listProjects(): Array<{
        key: string;
        path: string;
        title: string;
        count: number;
        updatedAt: number;
    }>;
    /** Append one entry and regenerate the project markdown. Returns the entry. */
    record(cwd: string, payload: EntryPayload, source?: MemoirSource | string): MemoirEntry;
    /** Remove one entry by id; regenerates the project markdown. */
    remove(cwd: string, id: string): boolean;
    /** Update an existing entry without deleting its id or creation time. */
    update(cwd: string, id: string, patch: EntryUpdate): MemoirEntry | undefined;
    /** Render one entry as a markdown bullet line. */
    renderEntryLine(entry: MemoirEntry): string;
    /** Cheap O(1) signature of one project's entries (count + tail id/time). */
    private renderSignature;
    /** Regenerate the full PROJECT_MEMORY.md content for one project. */
    renderMarkdown(cwd: string): string;
    /** Pure markdown assembly for one project's entries (no cache access). */
    private renderMarkdownNow;
    /** Absolute path of one project's memory file (no write). */
    projectFilePath(cwd: string): string;
    /** Regenerate and write the project memory file; returns its path. */
    writeProjectFile(cwd: string): string;
    /** Re-render all known project projections after a language change. */
    refreshProjectFiles(): void;
}
/** SHA-256 hex digest of a string, truncated for prompt-stability hashing. */
export declare function sha256(text: string, length?: number): string;
