// The last render crash, kept in Dexie so Diagnostics can show it and "Copy state as JSON"
// can carry it — a white screen in a cart is the one failure nobody can read from another
// phone. One row, overwritten each time; the boundary that caught it is what writes it.
import { db } from '@/lib/db'

export const LAST_CRASH_KEY = 'last_crash'
const MAX_STACK = 4000

export interface CrashRecord {
  at: string
  message: string
  stack: string | null
  component_stack: string | null
  /** pathname + search at the time, so "it broke on /rounds/3" is in the record. */
  route: string
  /** 'route' = a page crashed, the shell survived; 'shell' = the whole app fell over. */
  scope: 'route' | 'shell'
  user_agent: string
}

export function describeError(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack?.slice(0, MAX_STACK) ?? null }
  if (typeof err === 'string') return { message: err, stack: null }
  try {
    return { message: JSON.stringify(err).slice(0, 500), stack: null }
  } catch {
    return { message: String(err), stack: null }
  }
}

/** Never throws — a failure to record a crash must not become a second crash. */
export async function recordCrash(
  err: unknown,
  scope: CrashRecord['scope'],
  componentStack?: string | null,
): Promise<CrashRecord | null> {
  try {
    const { message, stack } = describeError(err)
    const rec: CrashRecord = {
      at: new Date().toISOString(),
      message,
      stack,
      component_stack: componentStack?.slice(0, MAX_STACK) ?? null,
      route: typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '',
      scope,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    }
    await db.sync_meta.put({ key: LAST_CRASH_KEY, value: rec })
    return rec
  } catch {
    return null
  }
}

export async function readLastCrash(): Promise<CrashRecord | null> {
  try {
    const row = await db.sync_meta.get(LAST_CRASH_KEY)
    return (row?.value as CrashRecord | undefined) ?? null
  } catch {
    return null
  }
}

export async function clearLastCrash(): Promise<void> {
  try {
    await db.sync_meta.delete(LAST_CRASH_KEY)
  } catch {
    /* nothing to do */
  }
}
