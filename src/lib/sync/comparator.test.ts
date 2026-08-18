import { describe, expect, it } from 'vitest'
import { compareStamps, incomingWins, parseStampTime, stampOf } from './comparator'

// The client_ids below are the ones supabase/tests/write_path.sql uses, and the four
// verdict cases mirror its assertions one for one. The comparator exists in two languages;
// these tests are the TypeScript half of proving they agree. The SQL half runs against
// real Postgres — a mocked RPC would prove nothing about the guard itself.
const CLIENT_A = '11111111-1111-1111-1111-111111111111'
const CLIENT_B = '22222222-2222-2222-2222-222222222222'

const stamp = (effective: string, clientId: string) => ({ effective, clientId })

describe('parseStampTime', () => {
  it('reads the Z form this client sends and the +00:00 form PostgREST returns', () => {
    expect(parseStampTime('2027-02-04T18:22:31.123Z')).toEqual(
      parseStampTime('2027-02-04T18:22:31.123000+00:00'),
    )
  })

  it('keeps microseconds — Postgres orders on them, so Date.parse alone is a data loss', () => {
    const a = stamp('2027-02-04T18:22:31.123456Z', CLIENT_A)
    const b = stamp('2027-02-04T18:22:31.123457Z', CLIENT_A)
    // Both truncate to the same millisecond; only full precision separates them.
    expect(Date.parse(a.effective)).toBe(Date.parse(b.effective))
    expect(compareStamps(a, b)).toBeLessThan(0)
  })

  it('applies a non-UTC offset', () => {
    expect(parseStampTime('2027-02-04T13:22:31-05:00')).toEqual(
      parseStampTime('2027-02-04T18:22:31Z'),
    )
  })

  it('treats a zoneless timestamp as UTC, as PostgREST renders timestamptz', () => {
    expect(parseStampTime('2027-02-04 18:22:31')).toEqual(parseStampTime('2027-02-04T18:22:31Z'))
  })
})

describe('the comparator verdicts (parity with the SQL guard)', () => {
  it('a newer timestamp wins', () => {
    expect(
      incomingWins(stamp('2026-08-17T13:00:00Z', CLIENT_A), stamp('2026-08-17T12:30:00Z', CLIENT_B)),
    ).toBe(true)
  })

  it('an older write is rejected as stale', () => {
    expect(
      incomingWins(stamp('2026-08-17T11:00:00Z', CLIENT_B), stamp('2026-08-17T12:30:00Z', CLIENT_A)),
    ).toBe(false)
  })

  it('an identical (timestamp, client_id) tie loses — which is what makes a replay idempotent', () => {
    const s = stamp('2026-08-17T12:30:00Z', CLIENT_A)
    expect(incomingWins(s, { ...s })).toBe(false)
  })

  it('a timestamp tie is broken by client_id, and the lower one loses', () => {
    const t = '2026-08-17T12:00:00Z'
    expect(incomingWins(stamp(t, CLIENT_A), stamp(t, CLIENT_B))).toBe(false)
    expect(incomingWins(stamp(t, CLIENT_B), stamp(t, CLIENT_A))).toBe(true)
  })

  it('compares client_id case-insensitively, matching Postgres uuid byte order', () => {
    const t = '2026-08-17T12:00:00Z'
    expect(compareStamps(stamp(t, CLIENT_A.toUpperCase()), stamp(t, CLIENT_A))).toBe(0)
  })
})

describe('rows without a stamp', () => {
  const stamped = {
    client_updated_at_effective: '2026-08-17T12:00:00Z',
    client_id: CLIENT_A,
  }

  it('anything beats a missing local row', () => {
    expect(incomingWins(stamped, undefined)).toBe(true)
  })

  it('a stamped row beats an unstamped one (a row that predates the write path)', () => {
    expect(incomingWins(stamped, { client_updated_at_effective: null, client_id: null })).toBe(true)
  })

  it('an UNSTAMPED row never beats a stamped one — this is the 18-lost-holes case', () => {
    expect(incomingWins({ client_updated_at_effective: null, client_id: null }, stamped)).toBe(false)
  })

  it('stampOf refuses a half-stamped row rather than inventing a tuple', () => {
    expect(stampOf({ client_updated_at_effective: '2026-08-17T12:00:00Z', client_id: null })).toBeNull()
  })
})
