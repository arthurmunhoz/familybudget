import { formatPhone } from '../src/lib/phone'

describe('formatPhone', () => {
  it('formats US numbers however they were typed', () => {
    expect(formatPhone('4151231234')).toBe('+1 (415) 123-1234')
    expect(formatPhone('(415) 123-1234')).toBe('+1 (415) 123-1234')
    expect(formatPhone('415.123.1234', 'US')).toBe('+1 (415) 123-1234')
    expect(formatPhone('1 415 123 1234')).toBe('+1 (415) 123-1234')
    expect(formatPhone('+1 4151231234')).toBe('+1 (415) 123-1234')
  })

  it('formats Brazilian mobiles and landlines', () => {
    expect(formatPhone('11987654321')).toBe('+55 (11) 98765-4321')
    expect(formatPhone('(11) 98765-4321', 'US')).toBe('+55 (11) 98765-4321')
    expect(formatPhone('+55 11 98765 4321')).toBe('+55 (11) 98765-4321')
    expect(formatPhone('5511987654321'.replace(/^/, '+'))).toBe('+55 (11) 98765-4321')
    expect(formatPhone('011 98765-4321')).toBe('+55 (11) 98765-4321')
    expect(formatPhone('2134567890', 'BR')).toBe('+55 (21) 3456-7890')
    expect(formatPhone('+55 21 3456-7890')).toBe('+55 (21) 3456-7890')
  })

  it('uses the device region only for the ambiguous 10 digits', () => {
    expect(formatPhone('2134567890', 'US')).toBe('+1 (213) 456-7890')
    expect(formatPhone('2134567890', 'BR')).toBe('+55 (21) 3456-7890')
  })

  it('prints other countries as code + groups', () => {
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 207 946 0958')
    expect(formatPhone('0044 2079460958')).toBe('+44 207 946 0958')
    expect(formatPhone('+351 912 345 678')).toBe('+351 912 345 678')
  })

  it('never guesses a country it cannot tell', () => {
    expect(formatPhone('912345678')).toBe('912 345 678')
  })

  it('leaves non-numbers alone', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone('  ')).toBe('')
    expect(formatPhone('ask at the desk')).toBe('ask at the desk')
    expect(formatPhone('123')).toBe('123')
  })
})
