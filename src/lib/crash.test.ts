import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { recordCrash, readLastCrash, clearLastCrash, describeError } from './crash'

beforeEach(async () => {
  await clearLastCrash()
})

describe('crash record', () => {
  it('records an Error with its stack and reads it back after a reopen', async () => {
    const rec = await recordCrash(new Error('boom'), 'route', 'in Enter\n in Layout')
    expect(rec?.message).toBe('boom')
    expect(rec?.scope).toBe('route')
    db.close()
    await db.open()
    const back = await readLastCrash()
    expect(back?.message).toBe('boom')
    expect(back?.component_stack).toContain('in Enter')
    expect(back?.stack).toContain('boom')
  })

  it('overwrites: only the latest crash is kept', async () => {
    await recordCrash(new Error('first'), 'route')
    await recordCrash(new Error('second'), 'shell')
    const back = await readLastCrash()
    expect(back?.message).toBe('second')
    expect(back?.scope).toBe('shell')
  })

  it('copes with non-Error throwables', () => {
    expect(describeError('plain string')).toEqual({ message: 'plain string', stack: null })
    expect(describeError({ code: 7 }).message).toBe('{"code":7}')
    expect(describeError(undefined).message).toBe('undefined')
  })

  it('truncates a runaway stack', async () => {
    const err = new Error('long')
    err.stack = 'x'.repeat(10_000)
    const rec = await recordCrash(err, 'route')
    expect(rec?.stack?.length).toBe(4000)
  })

  it('clear removes it', async () => {
    await recordCrash(new Error('gone'), 'route')
    await clearLastCrash()
    expect(await readLastCrash()).toBeNull()
  })
})
