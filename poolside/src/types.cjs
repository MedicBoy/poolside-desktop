// Shared JSDoc typedefs.
//
// This file is never required at runtime; it exists so `tsc --checkJs` has one place to resolve the
// shapes that cross module boundaries — most importantly the `SessionGroup` that used to be
// knowable only by reading hundreds of lines of main.cjs.

/**
 * @typedef {object} Health
 * @property {number} failures
 * @property {number} recoveries
 * @property {number} consecutive
 * @property {number} attempts
 * @property {boolean} exhausted
 * @property {string|null} lastFailureAt
 * @property {string|null} lastFailureReason
 * @property {string|null} nextAttemptAt
 */

/** A conservative display-only account value read from local OCR. */
/** @typedef {{label: string, value: number, confidence: number, observedAt: string, source: string, status?: 'current'|'uncertain'|'stale', statusLabel?: string}} VisibleReading */

/**
 * One account's open browser session and everything observed about it.
 * @typedef {object} SessionGroup
 * @property {import('electron').BrowserWindow} window
 * @property {import('electron').Session} session
 * @property {Set<import('electron').BrowserWindow>} children
 * @property {import('./session-fsm.cjs').SessionFsm} fsm
 * @property {{dispose: () => void}} [supervision]
 * @property {Health} [health]
 * @property {Footprint} footprint
 * @property {{used: boolean, reset: () => void, observe: (url: string, shop: boolean, now: number) => boolean}} [shopGate]
 * @property {number} [observationGeneration]
 * @property {{state: string, score?: number, evidence?: string[], visibleTables?: string[], tableMatch?: {table: string, method: string}|null, observedAt?: string, readings?: Record<string, VisibleReading>}|null} [gameScreen]
 * @property {Record<string, VisibleReading>} [visibleReadings]
 * @property {{status: 'checking'|'checked'|'error', ip?: string, checkedAt?: string}} [network]
 * @property {boolean} [inspecting]
 * @property {boolean} [monitoring]
 * @property {{state: string, score: number|null, observedAt: string}[]} [screenHistory]
 * @property {{state: string, since: string, message: string}|null} [screenAttention]
 * @property {{mode: 'dry-run', targetTable: string, state: string, retryCount: number, startedAt: string, updatedAt: string, deadlineAt: string|null, lastObservation: object|null, input: object, history: object[]}|null} [tableNavigation]
 * @property {string|null} [lastPersistedAt] timestamp of the last successful Poolside session save
 */

/**
 * The configured footprint of a live session and what was reported back about it. `summary` is computed
 * in the main process because the dashboard is a sandboxed page with no access to identity.cjs.
 * @typedef {object} Footprint
 * @property {object} identity
 * @property {string} [summary]
 * @property {any} route
 * @property {{applied: boolean, mode: string, error?: string}} [routeStatus]
 * @property {{applied: string[], attached: boolean, error?: string, skipped?: string}|null} [target]
 * @property {{cacheBytes: number|null, quotaBytes: number|null, overQuota: boolean, at: string}|null} [storage]
 * @property {{ok: boolean, resolved?: string, route?: any, matches?: boolean, error?: string, at: string}|null} [verified]
 */

/**
 * @typedef {(message: string, kind?: 'info'|'warning') => void} LogFn
 */

/**
 * One account's saved-session queue. Outlives its window so a debounced save still flushes on quit.
 * @typedef {object} ProfileStore
 * @property {Promise<unknown>} queue
 * @property {NodeJS.Timeout|undefined} timer
 * @property {Promise<void>} ready
 * @property {() => Promise<unknown>} flush
 */

/**
 * One account's profile bookkeeping, persisted. Volatile measurements (size on disk, ceiling, over-quota)
 * are *not* here: they are re-derived on every scan and belong in state.cjs, not in the document.
 * @typedef {object} CorruptionRecord
 * @property {number} count how many damaged saved sessions have been quarantined
 * @property {string|null} [lastAt]
 * @property {string|null} [lastReason]
 * @property {string|null} [lastAction]
 */

/**
 * @typedef {object} ProfileRecord
 * @property {number} [generation] how many times this account's storage directory has been established
 * @property {boolean} [established] set once the partition directory has actually been seen on disk
 * @property {string} [firstSeenAt]
 * @property {CorruptionRecord} [corruption]
 */

/**
 * What the last scan measured about a profile. Never persisted.
 * @typedef {object} ProfileReport
 * @property {string} id
 * @property {string} path
 * @property {number} directoryBytes
 * @property {number|null} carryOverBytes null when there is no carry-over file (unknown, not zero)
 * @property {number} totalBytes
 * @property {number} fileCount
 * @property {number} directoryCount
 * @property {number} unreadable
 * @property {boolean} truncated the walk stopped at its file cap, so the figure is a lower bound
 * @property {boolean} missing
 * @property {number|null} quotaBytes
 * @property {boolean} overQuota
 * @property {string} checkedAt
 */

/** The dashboard view: the durable record with whatever the last scan measured merged over it. */
/** @typedef {ProfileRecord & Partial<ProfileReport>} ProfileView */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} name
 * @property {'receiver'|'sender'} role
 * @property {boolean} archived
 * @property {string} createdAt
 * @property {string} [note] optional local reminder; never read from a browser page
 * @property {object} [identity] per-account overrides of the workspace identity defaults
 * @property {object} [proxy] per-account route, overrides the workspace default
 * @property {object} [recovery] per-account local reliability preferences
 * @property {string} [routePresetId] optional workspace route preset
 * @property {ProfileRecord} [profile] absent until the account has been opened at least once
 */

/**
 * @typedef {object} WorkspaceSettings
 * @property {string} table
 * @property {number} limit
 * @property {object} [identity] identity defaults for every account, overridden per account
 * @property {object} [proxy] route defaults for every account, overridden per account
 */

/**
 * @typedef {object} WorkspaceData
 * @property {number} version
 * @property {Account[]} accounts
 * @property {WorkspaceSettings} settings
 * @property {Record<string, object>} [windows] remembered window geometry, keyed by account id
 * @property {{id: string, name: string, enabled: boolean, spec: string, bypass: string}[]} [routePresets]
 */

/**
 * @typedef {object} ActivityEvent
 * @property {number} id
 * @property {string} at
 * @property {string} message
 * @property {'info'|'warning'} kind
 */

module.exports = {};
