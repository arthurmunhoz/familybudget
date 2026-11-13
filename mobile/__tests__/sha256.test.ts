import { createHash } from 'crypto'
import { sha256Hex } from '../src/lib/sha256'

describe('sha256Hex', () => {
  it('matches the standard vectors and node', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const s of ['1234', '9e1b0f2a-0000-4000-8000-000000000000:4821', 'ção 🙂', 'x'.repeat(200)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })
})
