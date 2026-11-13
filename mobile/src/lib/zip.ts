// A minimal ZIP writer (STORE method — no compression) in pure JS, for the
// family export: CSVs are small and PDFs/JPEGs barely compress anyway, so
// storing keeps it simple and dependency-free (no native module, no rebuild).
// UTF-8 file names (general-purpose flag bit 11). Tested against `unzip -t`
// in __tests__/zip.test.ts.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** The whole archive as bytes. */
export function makeZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const { time, date } = dosTime(when)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = utf8(e.name)
    const crc = crc32(e.data)
    const size = e.data.length

    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true) // version needed
    lh.setUint16(6, 0x0800, true) // UTF-8 names
    lh.setUint16(8, 0, true) // stored
    lh.setUint16(10, time, true)
    lh.setUint16(12, date, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, size, true)
    lh.setUint32(22, size, true)
    lh.setUint16(26, name.length, true)
    lh.setUint16(28, 0, true)
    locals.push(new Uint8Array(lh.buffer), name, e.data)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true) // made by
    ch.setUint16(6, 20, true) // needed
    ch.setUint16(8, 0x0800, true)
    ch.setUint16(10, 0, true)
    ch.setUint16(12, time, true)
    ch.setUint16(14, date, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, size, true)
    ch.setUint32(24, size, true)
    ch.setUint16(28, name.length, true)
    ch.setUint16(30, 0, true) // extra
    ch.setUint16(32, 0, true) // comment
    ch.setUint16(34, 0, true) // disk
    ch.setUint16(36, 0, true) // internal attrs
    ch.setUint32(38, 0, true) // external attrs
    ch.setUint32(42, offset, true)
    centrals.push(new Uint8Array(ch.buffer), name)

    offset += 30 + name.length + size
  }
  const cdSize = centrals.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
