/**
 * Birthday facts (lib/birthday.ts) — pure date maths behind the Family
 * "Birthday" page. The edge cases that matter: sign boundaries, Feb 29, the
 * countdown on the day itself, and a moon phase checked against real moons.
 */
import { birthdayThisMonth, daysAlive, generation, moonPhase, nextBirthday, nextMilestone, zodiacSign } from '@/lib/birthday'

describe('birthday facts', () => {
  it('counts days alive across leap years', () => {
    expect(daysAlive('2000-01-01', '2000-01-01')).toBe(0)
    expect(daysAlive('2000-01-01', '2001-01-01')).toBe(366)
    expect(daysAlive('1989-03-04', '2026-11-04')).toBe(13759)
  })

  it('counts down to the next birthday, and says 0 on the day', () => {
    expect(nextBirthday('1989-03-04', '2026-11-04')).toEqual({ date: '2027-03-04', inDays: 120, turning: 38 })
    expect(nextBirthday('1987-06-20', '2026-06-20')).toEqual({ date: '2026-06-20', inDays: 0, turning: 39 })
    expect(nextBirthday('1987-06-20', '2026-06-21').turning).toBe(40)
  })

  it('celebrates a Feb 29 birthday on Feb 28 in common years', () => {
    expect(nextBirthday('2000-02-29', '2027-01-10')).toEqual({ date: '2027-02-28', inDays: 49, turning: 27 })
    expect(nextBirthday('2000-02-29', '2028-01-10').date).toBe('2028-02-29')
  })

  it('finds the next thousand-day milestone', () => {
    expect(nextMilestone('1989-03-04', '2026-11-04')).toEqual({ days: 14000, date: '2027-07-03' })
  })

  it('puts sign boundaries on the right side', () => {
    expect(zodiacSign('1990-01-19')).toBe('capricorn')
    expect(zodiacSign('1990-01-20')).toBe('aquarius')
    expect(zodiacSign('1989-03-04')).toBe('pisces')
    expect(zodiacSign('1990-03-21')).toBe('aries')
    expect(zodiacSign('1990-12-21')).toBe('sagittarius')
    expect(zodiacSign('1990-12-22')).toBe('capricorn')
    expect(zodiacSign('1990-12-31')).toBe('capricorn')
  })

  it('names the moon phase of real moons', () => {
    expect(moonPhase('2024-04-08')).toBe(0) // total solar eclipse = new moon
    expect(moonPhase('2024-04-23')).toBe(4) // full moon
    expect(moonPhase('2025-09-07')).toBe(4) // full moon (lunar eclipse)
  })

  it('maps birth years to generations', () => {
    expect(generation(1945)).toBe('silent')
    expect(generation(1964)).toBe('boomer')
    expect(generation(1981)).toBe('millennial')
    expect(generation(1997)).toBe('genz')
    expect(generation(2013)).toBe('alpha')
  })

  it('shows the Home birthday card only for the rest of that month', () => {
    expect(birthdayThisMonth('1989-03-04', '2027-03-01')).toBe(true) // coming up
    expect(birthdayThisMonth('1989-03-04', '2027-03-04')).toBe(true) // today
    expect(birthdayThisMonth('1989-03-04', '2027-03-05')).toBe(false) // passed
    expect(birthdayThisMonth('1989-03-04', '2027-02-27')).toBe(false) // next month
  })
})
