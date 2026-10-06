/**
 * 폼텍 DesignPro 9 라벨 패키지(.dgz) 만들기.
 *
 * dgz는 zip이다 (울주 샘플 2026-07):
 *   Data/<엑셀 이름>_FD01.XLSX   라벨 데이터
 *   Design/<dgz 이름>.dgf        라벨 디자인 (3100 라벨지, [단발$] 같은 시트에 연결)
 * 엔트리 이름은 CP949 + Unicode Path extra(0x7075), UTF-8 플래그 없음.
 *
 * dgf 안의 문자열은 4바이트 길이 + 내용이다.
 *   엑셀 경로 (CP949): <문서>\Formtec\DesignPro9\Temp\<dgz 이름>\Data\<엑셀 이름>_FD01.XLSX — DesignPro가 패키지를 푸는 곳
 *   고정 문구 (UTF-16LE, 길이는 글자 수): 라벨에 찍히는 행사명
 *   끝부분 "65,NNNN/": NNNN = 파일 크기 - 325 (샘플 3개 모두)
 * 디자인(칸 위치·글꼴·연결 시트)은 템플릿 그대로 두고 이 세 가지만 바꾼다.
 */
import iconv from 'iconv-lite'
import JSZip from 'jszip'

export const DGF_MAGIC = 'Formtec Design Pro 9 Design File'
/** 앱에 들어 있는 템플릿의 행사명 자리 */
export const TEMPLATE_SHOW_NAME = '행사명'

interface Span {
  start: number
  end: number
}

const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const lengthBytes = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff])

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

const utf16 = (s: string) => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[2 * i] = c & 0xff
    out[2 * i + 1] = c >> 8
  }
  return out
}
const cp949 = (s: string) => new Uint8Array(iconv.encode(s, 'cp949'))

/** 엑셀 경로 문자열 (길이 포함 범위). ".XLSX"로 끝나는 길이 접두 문자열 */
function findDataPath(b: Uint8Array): Span | null {
  const upper = b.map((x) => (x >= 0x61 && x <= 0x7a ? x - 0x20 : x))
  const ext = new Uint8Array([0x2e, 0x58, 0x4c, 0x53, 0x58]) // .XLSX
  for (let at = indexOfBytes(upper, ext); at >= 0; at = indexOfBytes(upper, ext, at + 1)) {
    const end = at + ext.length
    for (let i = end - 5; i >= Math.max(0, end - 1024); i--) {
      if (u32(b, i) === end - (i + 4)) return { start: i, end }
    }
  }
  return null
}

/** 고정 문구(UTF-16, 앞 4바이트가 글자 수)가 text인 곳들 */
function findStaticTexts(b: Uint8Array, text: string): Span[] {
  const needle = utf16(text)
  const out: Span[] = []
  for (let at = indexOfBytes(b, needle); at >= 0; at = indexOfBytes(b, needle, at + 1)) {
    if (at >= 4 && u32(b, at - 4) === text.length) out.push({ start: at - 4, end: at + needle.length })
  }
  return out
}

/** "65,NNNN/" 의 NNNN 숫자 범위 */
function findTrailer(b: Uint8Array): { digits: Span; value: number; spaces: number } | null {
  const from = Math.max(0, b.length - 1024)
  const text = iconv.decode(Buffer.from(b.subarray(from)), 'latin1')
  const m = [...text.matchAll(/\d+,(\d+)\/( *)/g)].pop()
  if (!m || m.index === undefined) return null
  const start = from + m.index + m[0].indexOf(',') + 1
  return { digits: { start, end: start + m[1].length }, value: Number(m[1]), spaces: m[2].length }
}

export interface DgfInfo {
  dataPath: string
  /** 연결된 시트 (예: [단발$]) */
  sheet: string
  trailer: number | null
}

export function readDgf(dgf: Uint8Array): DgfInfo {
  if (iconv.decode(Buffer.from(dgf.subarray(0, DGF_MAGIC.length)), 'latin1') !== DGF_MAGIC) {
    throw new Error('폼텍 DesignPro 9 디자인 파일(.dgf)이 아닙니다.')
  }
  const path = findDataPath(dgf)
  if (!path) throw new Error('디자인 파일에서 연결된 엑셀 경로를 찾지 못했습니다.')
  let sheet = ''
  const after = path.end
  for (let i = after; i < Math.min(dgf.length - 4, after + 256); i++) {
    const n = u32(dgf, i)
    if (n >= 3 && n <= 64 && dgf[i + 4] === 0x5b && dgf[i + 4 + n - 1] === 0x5d) {
      sheet = iconv.decode(Buffer.from(dgf.subarray(i + 4, i + 4 + n)), 'cp949')
      break
    }
  }
  return {
    dataPath: iconv.decode(Buffer.from(dgf.subarray(path.start + 4, path.end)), 'cp949'),
    sheet,
    trailer: findTrailer(dgf)?.value ?? null
  }
}

export interface PatchOptions {
  dataPath: string
  /** 라벨에 찍히는 행사명. 템플릿에 templateShowName 문구가 없으면 무시 */
  showName?: string
  templateShowName?: string
}

/** 템플릿 dgf의 엑셀 경로·행사명을 바꾸고 끝부분 크기 값을 맞춘다 */
export function patchDgf(template: Uint8Array, opts: PatchOptions): Uint8Array {
  readDgf(template)
  const path = findDataPath(template)!
  const edits: { span: Span; bytes: Uint8Array }[] = []
  const pathBytes = cp949(opts.dataPath)
  edits.push({ span: path, bytes: new Uint8Array([...lengthBytes(pathBytes.length), ...pathBytes]) })
  if (opts.showName !== undefined) {
    const from = opts.templateShowName ?? TEMPLATE_SHOW_NAME
    for (const span of findStaticTexts(template, from)) {
      edits.push({ span, bytes: new Uint8Array([...lengthBytes(opts.showName.length), ...utf16(opts.showName)]) })
    }
  }
  const delta = edits.reduce((s, e) => s + e.bytes.length - (e.span.end - e.span.start), 0)
  const trailer = findTrailer(template)
  if (trailer) {
    // 숫자 자릿수가 바뀌면 뒤 공백으로 길이를 맞춰 파일 크기를 그대로 둔다
    const value = String(trailer.value + delta)
    const grow = value.length - (trailer.digits.end - trailer.digits.start)
    if (grow > trailer.spaces) throw new Error('디자인 파일 끝부분 형식을 바꿀 수 없습니다.')
    const tail = ' '.repeat(Math.max(0, -grow))
    const span = { start: trailer.digits.start, end: trailer.digits.end + 1 + Math.max(0, grow) }
    edits.push({ span, bytes: new Uint8Array([...cp949(value), 0x2f, ...cp949(tail)]) })
  }
  edits.sort((a, b) => a.span.start - b.span.start)
  const parts: Uint8Array[] = []
  let at = 0
  for (const e of edits) {
    parts.push(template.subarray(at, e.span.start), e.bytes)
    at = e.span.end
  }
  parts.push(template.subarray(at))
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export interface DgzOptions {
  /** 라벨 데이터 엑셀 */
  xlsx: Uint8Array
  /** 엑셀 이름 (확장자 없이). 패키지 안에서는 <이름>_FD01.XLSX */
  xlsxBase: string
  /** dgz 이름 (확장자 없이). 디자인 파일 이름도 같다 */
  dgzBase: string
  template: Uint8Array
  /** Windows 문서 폴더 (DesignPro가 패키지를 그 아래 Temp에 푼다) */
  documentsDir: string
  showName?: string
  date?: Date
}

export function dgzDataPath(documentsDir: string, dgzBase: string, xlsxBase: string): string {
  const docs = documentsDir.replace(/[\\/]+$/, '').replace(/\//g, '\\')
  return `${docs}\\Formtec\\DesignPro9\\Temp\\${dgzBase}\\Data\\${xlsxBase}_FD01.XLSX`
}

export async function buildDgz(opts: DgzOptions): Promise<Uint8Array> {
  const dgf = patchDgf(opts.template, {
    dataPath: dgzDataPath(opts.documentsDir, opts.dgzBase, opts.xlsxBase),
    showName: opts.showName
  })
  const zip = new JSZip()
  // zip 시각은 시간대 없는 현지 시각이다. JSZip은 UTC로 적으므로 미리 당겨 둔다
  const now = opts.date ?? new Date()
  const date = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  const fileOpts = { date, dosPermissions: 0x20, binary: true, createFolders: false }
  zip.file(`Data/${opts.xlsxBase}_FD01.XLSX`, opts.xlsx, fileOpts)
  zip.file(`Design/${opts.dgzBase}.dgf`, dgf, fileOpts)
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
    encodeFileName: (name) => cp949(name) as unknown as string
  })
}
