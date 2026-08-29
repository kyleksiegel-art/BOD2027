import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { nextStamp, resetClockCache } from './clock'

describe('the monotonic write clock', () => {
  beforeEach(async () => {
    await db.sync_meta.clear()
    resetClockCache()
    // Fake ONLY Date. fake-indexeddb schedules its transactions on real timers; faking
    // those deadlocks every Dexie call in this file.
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never issues the same stamp twice, even inside one millisecond', async () => {
    vi.setSystemTime(new Date('2027-02-06T14:00:00.000Z'))
    const a = await nextStamp()
    const b = await nextStamp()
    const c = await nextStamp()
    expect(new Set([a, b, c]).size).toBe(3)
    expect(a < b && b < c).toBe(true)
  })

  it('keeps moving forward when the wall clock jumps BACKWARDS', async () => {
    // The real scenario: four hours in a dead zone on the back nine, then the phone
    // reacquires signal and NTP corrects it backwards by ninety seconds. Without this,
    // every subsequent write is stale against the device's own earlier rows and entries
    // silently revert with no error anywhere.
    vi.setSystemTime(new Date('2027-02-06T14:00:00.000Z'))
    const before = await nextStamp()

    vi.setSystemTime(new Date('2027-02-06T13:58:30.000Z'))
    const after = await nextStamp()

    expect(after > before).toBe(true)
  })

  it('survives a force-quit: the high-water mark is read back out of Dexie', async () => {
    vi.setSystemTime(new Date('2027-02-06T14:00:00.000Z'))
    const before = await nextStamp()

    // App killed and cold-started, with the clock now behind where it was.
    db.close()
    await db.open()
    resetClockCache()
    vi.setSystemTime(new Date('2027-02-06T13:00:00.000Z'))

    const after = await nextStamp()
    expect(after > before).toBe(true)
  })
})
