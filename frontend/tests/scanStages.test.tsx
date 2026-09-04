/**
 * The scan checklist, and the contract it depends on.
 *
 * The stage keys are agreed across two languages and two repositories'
 * worth of distance: the pipeline in services.py emits them, the panel here
 * renders a row per key. Nothing in either toolchain checks the other, and
 * the failure is quiet — rename a stage on the server and the matching row
 * simply never ticks, which looks like a slow scan rather than a bug.
 *
 * So the first test reads the Python. It is an unusual thing for a frontend
 * test to do, and it is the only place the two lists actually meet.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanProgressPanel, SCAN_STAGE_KEYS } from '@/components/resume/ScanProgressPanel'

describe('the stage contract with the backend', () => {
  it('renders exactly the stages the server emits, in the same order', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../backend/app/modules/resume_analyzer/services.py'),
      'utf-8',
    )
    const block = source.match(/SCAN_STAGES:\s*tuple\[str, \.\.\.\]\s*=\s*\(([\s\S]*?)\)/)
    expect(block, 'SCAN_STAGES not found in services.py — did it get renamed?').toBeTruthy()

    const serverStages = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
    expect(serverStages.length).toBeGreaterThan(0)
    expect(SCAN_STAGE_KEYS).toEqual(serverStages)
  })
})

describe('ScanProgressPanel', () => {
  beforeEach(() => {
    // jsdom has no matchMedia, and the panel reads it for reduced motion.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  })


  it('jumps to the server stage rather than waiting for its timer', () => {
    render(<ScanProgressPanel serverStage="diagnostics" />)
    // "Live" is the honest label only when real events are arriving.
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/Pass 05 \/ 05/)).toBeInTheDocument()
  })

  it('says "Working", not "Live", when no events are arriving', () => {
    /* The panel narrated on a timer and called itself Live the whole time.
       That is the small dishonesty that costs trust the moment someone
       notices the checklist ticks identically on a 200ms scan and a 20s one. */
    render(<ScanProgressPanel />)
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('does not move backwards when a late event arrives out of order', () => {
    /* SSE frames can be delivered late. A stage behind where the checklist
       already is must not rewind it — a checklist that goes backwards reads
       as a restart. */
    const { rerender } = render(<ScanProgressPanel serverStage="diagnostics" />)
    expect(screen.getByText(/Pass 05 \/ 05/)).toBeInTheDocument()

    rerender(<ScanProgressPanel serverStage="extracting" />)
    expect(screen.getByText(/Pass 05 \/ 05/)).toBeInTheDocument()
  })

  it('ignores a stage key it does not know instead of blanking the list', () => {
    render(<ScanProgressPanel serverStage="something-the-server-added-later" />)
    expect(screen.getByText('Reading your resume')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
  })
})
