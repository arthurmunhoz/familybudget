import { foldRepeats } from '../src/lib/voice'

describe('foldRepeats (quiz voice answers)', () => {
  it('folds a word reported twice', () => {
    expect(foldRepeats('borboleta borboleta')).toBe('borboleta')
    expect(foldRepeats('Paris. Paris')).toBe('Paris')
  })
  it('folds a repeated phrase', () => {
    expect(foldRepeats('Rio de Janeiro Rio de Janeiro')).toBe('Rio de Janeiro')
  })
  it('leaves real answers alone', () => {
    expect(foldRepeats('Rio de Janeiro')).toBe('Rio de Janeiro')
    expect(foldRepeats('bem bem-te-vi')).toBe('bem bem-te-vi')
    expect(foldRepeats('Nova Zelândia')).toBe('Nova Zelândia')
  })
})
