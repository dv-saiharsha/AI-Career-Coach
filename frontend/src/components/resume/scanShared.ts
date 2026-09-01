/**
 * Types and motion constants shared across the scan flow.
 *
 * These lived in one file before the Resume Studio split and were duplicated
 * verbatim into each extracted component. Structurally-compatible duplicate
 * unions are the dangerous kind: TypeScript never flags a divergence, so
 * adding a member in one copy silently breaks the other's contract. One owner
 * instead.
 */

/** Lifecycle of a resume scan request. */
export type ScanStatus = 'idle' | 'loading' | 'success' | 'error'

/** Lifecycle of the "tailor my resume" PDF generation. */
export type GenStatus = 'idle' | 'loading' | 'done' | 'error'

/** Which analysis tab is open on the results view. */
export type ResultTab = 'missing' | 'suggestions' | 'keywords'

/** The scan flow's entrance curve. Kept raw rather than pulling `ease` from
 *  lib/motion.ts because callers pair it with their own durations. */
export const SCAN_EASE = [0.22, 1, 0.36, 1] as const
