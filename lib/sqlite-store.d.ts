/**
 * SQLite persistence for the memoir store. The database is the structured
 * source of truth; PROJECT_MEMORY.md remains a generated projection.
 */
import type { MemoirStoreFile } from './store.js';
/** Current SQLite schema version. */
export declare const DATABASE_SCHEMA_VERSION = 1;
/** Relational persistence used by MemoirStore. */
export declare class SqliteMemoirDatabase {
    readonly path: string;
    private database;
    private corruptBackupCount;
    /**
     * @param path - Absolute or caller-resolved SQLite database path.
     */
    constructor(path: string);
    private openWithRecovery;
    private configure;
    private migrate;
    /** SQLite change counter for writes performed by other connections. */
    dataVersion(): number;
    /** Number of corrupt database files preserved by this instance. */
    corruptBackups(): number;
    /** Return a metadata value, or undefined. */
    metadata(key: string): string | undefined;
    /** Persist one metadata value. */
    setMetadata(key: string, value: string): void;
    /** Read all projects and entries into the store's stable in-memory shape. */
    read(formatVersion: number): MemoirStoreFile;
    /** Replace the relational snapshot atomically and append an audit diff. */
    replace(file: MemoirStoreFile): void;
    private entrySnapshots;
    private appendAuditDiff;
    /** Close the SQLite connection. */
    close(): void;
}
