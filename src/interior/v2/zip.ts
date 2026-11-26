// 압축 없이 묶기만 하는(store) ZIP 만들기. 외부 라이브러리 없음. 화면 API 없음.
// 파일 이름은 UTF-8 표시(플래그 0x0800)를 켜서 한글 이름도 그대로 보인다.
let table: Uint32Array | null = null
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array }
export function makeZip(files: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const DATE = 0x21 // 1980-01-01 (시각 정보는 쓰지 않는다)
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, 0, true); lh.setUint16(12, DATE, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true)
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    const local = new Uint8Array(30 + name.length + size)
    local.set(new Uint8Array(lh.buffer), 0); local.set(name, 30); local.set(f.data, 30 + name.length)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true)
    ch.setUint16(12, 0, true); ch.setUint16(14, DATE, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true)
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true)
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true)
    const central = new Uint8Array(46 + name.length)
    central.set(new Uint8Array(ch.buffer), 0); central.set(name, 46)
    locals.push(local); centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const l of locals) { out.set(l, p); p += l.length }
  for (const c of centrals) { out.set(c, p); p += c.length }
  out.set(new Uint8Array(end.buffer), p)
  return out
}

// 묶은 ZIP을 다시 읽어 이름과 내용 꺼내기 (검사용)
export function readZip(zip: Uint8Array): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const e = zip.length - 22
  if (v.getUint32(e, true) !== 0x06054b50) throw new Error('ZIP 끝 표시가 없어요.')
  const n = v.getUint16(e + 10, true)
  let p = v.getUint32(e + 16, true)
  const dec = new TextDecoder(), out: ZipEntry[] = []
  for (let i = 0; i < n; i++) {
    const size = v.getUint32(p + 24, true), nl = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true)
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nl))
    const lnl = v.getUint16(off + 26, true), lel = v.getUint16(off + 28, true)
    const data = zip.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + size)
    if (crc32(data) !== v.getUint32(p + 16, true)) throw new Error(`${name}: CRC가 맞지 않아요.`)
    out.push({ name, data })
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
  }
  return out
}
