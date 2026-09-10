/**
 * SQLite persistence for the memoir store. The database is the structured
 * source of truth; PROJECT_MEMORY.md remains a generated projection.
 */

import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MemoirEntry, MemoirStoreFile } from './store.js'

/** Current SQLite schema version. */
export const DATABASE_SCHEMA_VERSION = 1

interface SqliteProjectRow {
  project_key: string
  path: string
  title: string
  updated_at: number
}

interface SqliteEntryRow {
  id: string
  project_key: string
  section: MemoirEntry['section']
  title: string | null
  content: string
  created_at: number
  updated_at: number
  version: number
  source_session_id: string | null
  source_turn_id: number | null
  importance: number
  pinned: number
  status: MemoirEntry['status']
  supersedes_json: string | null
  tags_json: string | null
}

function parseStringArray(value: string | null): string[] | undefined {
  if (value === null) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const values = parsed.filter((item): item is string => typeof item === 'string')
    return values.length === 0 ? undefined : values
  } catch {
    return undefined
  }
}

function asNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}

function isCorruptDatabase(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /not a database|database disk image is malformed|file is not a database/i.test(error.message)
}

/** Relational persistence used by MemoirStore. */
export class SqliteMemoirDatabase {
  readonly path: string
  private database: DatabaseSync
  private corruptBackupCount = 0

  /**
   * @param path - Absolute or caller-resolved SQLite database path.
   */
  constructor(path: string) {
    this.path = path
    const directory = dirname(path)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.database = this.openWithRecovery()
  }

  private openWithRecovery(): DatabaseSync {
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.path)
      this.configure(database)
      this.migrate(database)
      chmodSync(this.path, 0o600)
      return database
    } catch (error) {
      try {
        database?.close()
      } catch {
        // The failed open owns no reusable state.
      }
      if (!existsSync(this.path) || !isCorruptDatabase(error)) throw error
      const backupPath = `${this.path}.corrupt.${Date.now()}`
      renameSync(this.path, backupPath)
      this.corruptBackupCount++
      const recovered = new DatabaseSync(this.path)
      this.configure(recovered)
      this.migrate(recovered)
      chmodSync(this.path, 0o600)
      return recovered
    }
  }

  private configure(database: DatabaseSync): void {
    database.exec('PRAGMA foreign_keys = ON')
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA synchronous = NORMAL')
    database.exec('PRAGMA busy_timeout = 5000')
  }

  private migrate(database: DatabaseSync): void {
    const row = database.prepare('PRAGMA user_version').get() as { user_version: number | bigint }
    const current = asNumber(row.user_version)
    if (current > DATABASE_SCHEMA_VERSION) {
      throw new Error(`dsh-memoir-sqlite: database schema ${current} is newer than supported ${DATABASE_SCHEMA_VERSION}`)
    }
    if (current === 0) {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE projects (
          project_key TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          title TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE entries (
          id TEXT PRIMARY KEY,
          project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          section TEXT NOT NULL CHECK (section IN ('work', 'lessons', 'actions', 'note')),
          title TEXT,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          version INTEGER NOT NULL CHECK (version >= 1),
          source_session_id TEXT,
          source_turn_id INTEGER,
          importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
          pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
          supersedes_json TEXT,
          tags_json TEXT,
          UNIQUE (project_key, ordinal)
        );
        CREATE INDEX entries_project_time ON entries(project_key, created_at, ordinal);
        CREATE TABLE entry_revisions (
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_id TEXT NOT NULL,
          project_key TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
          version INTEGER NOT NULL,
          snapshot_json TEXT NOT NULL,
          changed_at INTEGER NOT NULL
        );
        CREATE INDEX entry_revisions_entry ON entry_revisions(entry_id, audit_id);
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
        COMMIT;
      `)
    }
  }

  /** SQLite change counter for writes performed by other connections. */
  dataVersion(): number {
    const row = this.database.prepare('PRAGMA data_version').get() as { data_version: number | bigint }
    return asNumber(row.data_version)
  }

  /** Number of corrupt database files preserved by this instance. */
  corruptBackups(): number {
    return this.corruptBackupCount
  }

  /** Return a metadata value, or undefined. */
  metadata(key: string): string | undefined {
    const row = this.database.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  /** Persist one metadata value. */
  setMetadata(key: string, value: string): void {
    this.database.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  /** Read all projects and entries into the store's stable in-memory shape. */
  read(formatVersion: number): MemoirStoreFile {
    const projects: MemoirStoreFile['projects'] = {}
    const projectRows = this.database.prepare(`
      SELECT project_key, path, title, updated_at
      FROM projects
      ORDER BY rowid
    `).all() as unknown as SqliteProjectRow[]
    for (const row of projectRows) {
      projects[row.project_key] = {
        path: row.path,
        title: row.title,
        updatedAt: asNumber(row.updated_at),
        entries: [],
      }
    }
    const entryRows = this.database.prepare(`
      SELECT id, project_key, section, title, content, created_at, updated_at,
             version, source_session_id, source_turn_id, importance, pinned,
             status, supersedes_json, tags_json
      FROM entries
      ORDER BY project_key, ordinal
    `).all() as unknown as SqliteEntryRow[]
    for (const row of entryRows) {
      const project = projects[row.project_key]
      if (project === undefined) continue
      const source = row.source_session_id !== null || row.source_turn_id !== null
        ? {
            ...(row.source_session_id !== null ? { sessionId: row.source_session_id } : {}),
            ...(row.source_turn_id !== null ? { turnId: asNumber(row.source_turn_id) } : {}),
          }
        : undefined
      const supersedes = parseStringArray(row.supersedes_json)
      const tags = parseStringArray(row.tags_json)
      project.entries.push({
        id: row.id,
        section: row.section,
        ...(row.title !== null ? { title: row.title } : {}),
        content: row.content,
        time: asNumber(row.created_at),
        updatedAt: asNumber(row.updated_at),
        version: asNumber(row.version),
        ...(source !== undefined ? { source } : {}),
        importance: asNumber(row.importance),
        pinned: row.pinned === 1,
        status: row.status,
        ...(supersedes !== undefined ? { supersedes } : {}),
        ...(tags !== undefined ? { tags } : {}),
      })
    }
    return { version: formatVersion, projects }
  }

  /** Replace the relational snapshot atomically and append an audit diff. */
  replace(file: MemoirStoreFile): void {
    const before = this.entrySnapshots()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec('DELETE FROM entries; DELETE FROM projects;')
      const insertProject = this.database.prepare(`
        INSERT INTO projects(project_key, path, title, updated_at) VALUES (?, ?, ?, ?)
      `)
      const insertEntry = this.database.prepare(`
        INSERT INTO entries(
          id, project_key, ordinal, section, title, content, created_at,
          updated_at, version, source_session_id, source_turn_id, importance,
          pinned, status, supersedes_json, tags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const after = new Map<string, { projectKey: string; entry: MemoirEntry }>()
      for (const [key, project] of Object.entries(file.projects)) {
        insertProject.run(key, project.path, project.title, project.updatedAt)
        project.entries.forEach((entry, ordinal) => {
          insertEntry.run(
            entry.id,
            key,
            ordinal,
            entry.section,
            entry.title ?? null,
            entry.content,
            entry.time,
            entry.updatedAt ?? entry.time,
            entry.version ?? 1,
            entry.source?.sessionId ?? null,
            entry.source?.turnId ?? null,
            entry.importance ?? 3,
            entry.pinned === true ? 1 : 0,
            entry.status ?? 'active',
            entry.supersedes === undefined ? null : JSON.stringify(entry.supersedes),
            entry.tags === undefined ? null : JSON.stringify(entry.tags),
          )
          after.set(entry.id, { projectKey: key, entry })
        })
      }
      this.appendAuditDiff(before, after)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private entrySnapshots(): Map<string, { projectKey: string; entry: MemoirEntry }> {
    const file = this.read(0)
    const result = new Map<string, { projectKey: string; entry: MemoirEntry }>()
    for (const [projectKey, project] of Object.entries(file.projects)) {
      for (const entry of project.entries) result.set(entry.id, { projectKey, entry })
    }
    return result
  }

  private appendAuditDiff(
    before: Map<string, { projectKey: string; entry: MemoirEntry }>,
    after: Map<string, { projectKey: string; entry: MemoirEntry }>,
  ): void {
    const insert = this.database.prepare(`
      INSERT INTO entry_revisions(entry_id, project_key, operation, version, snapshot_json, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const now = Date.now()
    for (const [id, current] of after) {
      const previous = before.get(id)
      const operation = previous === undefined ? 'insert' : 'update'
      if (previous !== undefined && JSON.stringify(previous.entry) === JSON.stringify(current.entry)) continue
      insert.run(id, current.projectKey, operation, current.entry.version ?? 1, JSON.stringify(current.entry), now)
    }
    for (const [id, previous] of before) {
      if (after.has(id)) continue
      insert.run(id, previous.projectKey, 'delete', previous.entry.version ?? 1, JSON.stringify(previous.entry), now)
    }
  }

  /** Close the SQLite connection. */
  close(): void {
    this.database.close()
  }
}
