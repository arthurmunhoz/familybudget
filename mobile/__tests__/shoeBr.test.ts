import { composeShoe, displayValue, parseShoe, shoeConvert } from '../src/apps/family/units'
import { composePhone, defaultPhoneCountry, formatLocalTyping, splitStoredPhone } from '../src/lib/phone'

describe('Brazilian shoe sizes', () => {
  it('stores, reads and shows BR', () => {
    expect(composeShoe('BR', 'W', '36')).toBe('BR W 36')
    expect(parseShoe('BR W 36')).toEqual({ system: 'BR', gender: 'W', value: 36 })
    expect(displayValue('shoe', 'BR W 36')).toBe('BR 36')
  })
  it('converts about two below EU', () => {
    expect(shoeConvert(40, 'M', 'EU', 'BR')).toBe(38)
    expect(shoeConvert(38, 'M', 'BR', 'EU')).toBe(40)
    expect(shoeConvert(7, 'W', 'US', 'BR')).toBe(36)
  })
})

describe('phone with a picked country', () => {
  it('a Portuguese user in the US keeps a US number', () => {
    expect(defaultPhoneCountry('pt', 'US')).toBe('US')
    expect(formatLocalTyping('4151231234', '', 'US')).toBe('(415) 123-1234')
    expect(composePhone('US', '(415) 123-1234')).toBe('+1 (415) 123-1234')
  })
  it('Brazil formats Brazilian, whatever the device', () => {
    expect(formatLocalTyping('11987654321', '', 'BR')).toBe('(11) 98765-4321')
    expect(composePhone('BR', '(11) 98765-4321')).toBe('+55 (11) 98765-4321')
    expect(composePhone('BR', '011 98765-4321')).toBe('+55 (11) 98765-4321')
  })
  it('Mexico/Spain are never shaped like the US', () => {
    expect(formatLocalTyping('5512345678', '', 'MX')).not.toContain('(')
    expect(composePhone('MX', '5512345678')).toBe('+52 551 234 5678')
    expect(composePhone('ES', '612345678')).toBe('+34 612 345 678')
  })
  it('reads a stored number back into country + local part', () => {
    expect(splitStoredPhone('+55 (11) 98765-4321', 'US')).toEqual({ country: 'BR', local: '(11) 98765-4321' })
    expect(splitStoredPhone('+1 (415) 123-1234', 'BR')).toEqual({ country: 'US', local: '(415) 123-1234' })
    expect(splitStoredPhone('+1 (416) 123-1234', 'CA')).toEqual({ country: 'CA', local: '(416) 123-1234' })
    expect(splitStoredPhone('', 'MX')).toEqual({ country: 'MX', local: '' })
  })
  it('a number typed with its own +code keeps it', () => {
    expect(composePhone('US', '+55 11 98765 4321')).toBe('+55 (11) 98765-4321')
  })
})

describe('Mexican shoe sizes (cm)', () => {
  it('reads and converts MX', () => {
    expect(parseShoe('MX M 26')).toEqual({ system: 'MX', gender: 'M', value: 26 })
    expect(shoeConvert(8, 'M', 'US', 'MX')).toBe(26)
    expect(shoeConvert(26, 'M', 'MX', 'BR')).toBe(39)
  })
})

describe('phone length cap', () => {
  it('refuses digits past the country length', () => {
    expect(formatLocalTyping('(415) 123-12345', '(415) 123-1234', 'US')).toBe('(415) 123-1234')
    expect(formatLocalTyping('(11) 98765-43210', '(11) 98765-4321', 'BR')).toBe('(11) 98765-4321')
    expect(formatLocalTyping('612 345 6789', '612 345 678', 'ES')).toBe('612 345 678')
    expect(formatLocalTyping('+55 11 98765 4321 9999', '+55 (11) 98765-4321 999', 'US')).toBe('+55 (11) 98765-4321 999')
  })
  it('still allows a trunk 0 / leading 1', () => {
    expect(formatLocalTyping('14151231234', '', 'US')).toBe('1 (415) 123-1234')
    expect(formatLocalTyping('011987654321', '', 'BR')).not.toBe('')
  })
})
