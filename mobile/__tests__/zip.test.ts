import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { crc32, makeZip, utf8 } from '../src/lib/zip'

describe('makeZip (family export)', () => {
  it('crc32 matches the known value', () => {
    expect(crc32(utf8('123456789')).toString(16)).toBe('cbf43926')
  })
  it('writes an archive unzip accepts, with UTF-8 names', () => {
    const zip = makeZip([
      { name: 'dinheiro.csv', data: utf8('a,b\n1,2\n') },
      { name: 'documentos/Certidão de casamento.pdf', data: new Uint8Array([37, 80, 68, 70, 0, 255]) },
    ])
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    const f = join(dir, 'x.zip')
    writeFileSync(f, zip)
    const out = execFileSync('unzip', ['-t', f]).toString()
    expect(out).toContain('No errors detected')
    expect(execFileSync('unzip', ['-p', f, 'dinheiro.csv']).toString()).toBe('a,b\n1,2\n')
  })
})
