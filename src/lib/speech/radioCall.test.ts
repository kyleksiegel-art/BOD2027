import { describe, expect, it } from 'vitest'
import { buildFieldStory } from '@/lib/data/fieldStory'
import { reportDb, ROUND_ONE } from '@/test/reportFixture'
import { radioScript } from './radioCall'
import { pickVoice } from './speak'

describe('radioScript', () => {
  it('reads the real Round 1 oldest hole first, with an open and a close', () => {
    const vm = buildFieldStory(reportDb(ROUND_ONE, { ctp: { 6: 2, 8: 2, 14: 2, 16: 1 } }))!
    const lines = radioScript(vm)
    expect(lines[0]).toBe("Here's how round 1 went on Streamsong Red.")
    expect(lines[1]).toBe('The 1st. Kyle and Chris share the early lead.')
    expect(lines).toContain('The 3rd through the 5th. Chris birdies the 3rd and Kyle and Adam birdie the 4th. Chris leads by 2.')
    expect(lines).toContain("At the turn, it's Chris 25, Kyle 15, Jon 11, Adam 9.")
    expect(lines).toContain('The 16th. Chris makes a net birdie to lead by 11. Kyle wins closest to the pin.')
    expect(lines.at(-2)).toMatch(/^The 18th\. .*Final tally: Chris 44, Kyle 36, Jon 31, Adam 27\.$/)
    expect(lines.at(-1)).toBe("That's the round.")
    expect(lines.join(' ')).not.toMatch(/CTP|–/)
  })

  it('calls a live round as it stands, a half-finished hole included', () => {
    const db = reportDb(ROUND_ONE, { status: 'in_progress' })
    db.scores = db.scores.filter((sc) => sc.hole_number <= 11 || (sc.hole_number === 12 && /^0000000[13]/.test(sc.player_id)))
    const lines = radioScript(buildFieldStory(db)!)
    expect(lines[0]).toBe("Here's the call from Streamsong Red, round 1, through the 12th.")
    expect(lines.at(-2)).toBe('On the 12th, Kyle and Chris are in. Kyle birdies for a net eagle. Jon and Adam still to post.')
    expect(lines.at(-1)).toBe('More as it happens.')
  })
})

describe('pickVoice', () => {
  const v = (name: string, lang = 'en-US', localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice
  it('prefers Premium, then Enhanced, and never a novelty voice', () => {
    expect(pickVoice([v('Samantha'), v('Zoe (Premium)'), v('Evan (Enhanced)')])!.name).toBe('Zoe (Premium)')
    expect(pickVoice([v('Samantha'), v('Evan (Enhanced)')])!.name).toBe('Evan (Enhanced)')
    expect(pickVoice([v('Zarvox'), v('Daniel', 'en-GB')])!.name).toBe('Daniel')
    expect(pickVoice([v('Thomas', 'fr-FR')])).toBeNull()
  })
})
