/**
 * 엑셀로 열었다 저장해서 깨진 CSV를 원본과 대조해 되돌린다.
 *
 * 엑셀이 바꾸는 값 (샘플 2026-10-06):
 * - '-'로 시작하는 직렬 TILT를 수식으로 계산 ("-60-60" → -120, "-75--45-75" → -105)
 * - 숫자처럼 보이는 값의 앞자리 0 ("030" → 30, HH "00" → 0), 지수 표기 ("1E5" → 1.00E+05)
 * 손상값이 원본값을 엑셀이 바꾼 모양일 때만 되돌리므로, 사람이 일부러 고친 값(HH 이동, CONTROL 이름 등)은 그대로 남는다.
 */
import { normalizeHeader } from './columns'
import { parseTilts } from './jig'
import type { Issue, ParsedCsv } from './types'

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/
const SIGNED_SUM = /^[+-][\d.+-]*\d$/
const SCIENTIFIC = /^(\d+(?:\.\d+)?)E\+?(\d+)$/i

/** "-75--45-75"처럼 +, -만 있는 식을 엑셀처럼 계산한다. 식이 아니면 null */
function evalSignedSum(text: string): number | null {
  if (!SIGNED_SUM.test(text) || PLAIN_NUMBER.test(text)) return null
  let total = 0
  let rest = text
  while (rest) {
    const m = /^([+-]+)(\d+(?:\.\d+)?)/.exec(rest)
    if (!m) return null
    const negative = [...m[1]].filter((c) => c === '-').length % 2 === 1
    total += (negative ? -1 : 1) * Number(m[2])
    rest = rest.slice(m[0].length)
  }
  return total
}

/** 엑셀이 일반 서식으로 숫자를 다시 쓸 때의 모양 */
function excelNumber(n: number): string {
  return String(Number(n.toPrecision(15)))
}

/** 원본 셀 값을 엑셀이 열고 저장하면 나올 수 있는 값들 (원본 그대로는 빼고) */
export function excelForms(value: string): string[] {
  const v = value.trim()
  if (!v) return []
  const forms = new Set<string>()
  const sum = evalSignedSum(v)
  if (sum !== null) forms.add(excelNumber(sum))
  if (PLAIN_NUMBER.test(v) && v.replace(/\D/g, '').length <= 15) forms.add(excelNumber(Number(v)))
  const sci = SCIENTIFIC.exec(v)
  if (sci) {
    const mantissa = Number(sci[1])
    const exp = Number(sci[2])
    forms.add(`${mantissa.toFixed(2)}E+${String(exp).padStart(2, '0')}`)
    const n = mantissa * 10 ** exp
    if (n < 1e11) forms.add(excelNumber(n))
  }
  forms.delete(v)
  forms.delete(value)
  return [...forms]
}

/** 손상값이 원본값을 엑셀이 바꾼 모양인지 */
export function isExcelDamage(original: string, damaged: string): boolean {
  if (original === damaged) return false
  return excelForms(original).includes(damaged.trim())
}

/**
 * FM-A 주소(모듈 2자리 + 핀 1자리)를 엑셀이 바꾼 모양에서 되돌린다.
 * "30" → "030", "1.00E+05" → "1E5". 되돌릴 게 없으면 그대로.
 */
export function repairAddress(addr: string): string {
  const a = addr.trim()
  if (/^[0-9A-F]{1,2}$/i.test(a)) return a.padStart(3, '0')
  const sci = /^(\d)(?:\.0+)?E\+0*(\d)$/i.exec(a)
  if (sci) return `${sci[1]}E${sci[2]}`
  return addr
}

export interface RestoreFix {
  column: string
  count: number
  examples: string[]
}

export interface RestoreResult {
  csv: ParsedCsv
  total: number
  matched: number
  fixes: RestoreFix[]
  /** 원본에서 짝을 못 찾은 행 (줄 번호) */
  unmatched: number[]
  issues: Issue[]
}

/** 행 짝 찾기 열. HH(구간 이동)·TYPE(사람이 고치기도 함)은 빼고 점수로만 본다 */
const KEY_COLUMNS = ['POS', 'EFFECTDESCRIPTION', 'QTY', 'MM', 'SS', 'FF']
const NUMERIC_KEYS = new Set(['QTY', 'MM', 'SS', 'FF'])

interface OriginalRow {
  file: number
  row: string[]
  used: boolean
}

function columnIndex(headers: string[]): Map<string, number> {
  const m = new Map<string, number>()
  headers.forEach((h, i) => {
    const k = normalizeHeader(h)
    if (k && !m.has(k)) m.set(k, i)
  })
  return m
}

const normKeyValue = (col: string, v: string) => {
  const t = (v ?? '').trim()
  if (NUMERIC_KEYS.has(col) && PLAIN_NUMBER.test(t)) return String(Number(t))
  return t.toLowerCase()
}
const sameNumber = (a: string, b: string) => {
  const x = a.trim()
  const y = b.trim()
  return x === y || (PLAIN_NUMBER.test(x) && PLAIN_NUMBER.test(y) && Number(x) === Number(y))
}
/** 원본이 앞자리 0으로 자릿수를 맞춘 정수면, 0이 빠진 손상값을 같은 자릿수로 채운다 ("01" 원본, "0" → "00") */
function padLike(original: string, damaged: string): string | null {
  const o = original.trim()
  const d = damaged.trim()
  if (!/^0\d+$/.test(o) || !/^\d+$/.test(d) || d.length >= o.length) return null
  return d.padStart(o.length, '0')
}
const sameAddress = (a: string, b: string) => repairAddress(a).toUpperCase() === repairAddress(b).toUpperCase()

/**
 * originals: 엑셀을 거치지 않은 원본 (여러 개면 합쳐서 찾는다)
 * damaged: 엑셀로 저장한 파일. 헤더·행 구성(나눈 범위, 지운 열)은 이 파일을 따른다.
 */
export function restoreCsv(originals: ParsedCsv[], damaged: ParsedCsv): RestoreResult {
  const dCols = columnIndex(damaged.headers)
  const oCols = originals.map((o) => columnIndex(o.headers))
  const keyCols = KEY_COLUMNS.filter((k) => dCols.has(k) && oCols.every((m) => m.has(k)))

  const index = new Map<string, OriginalRow[]>()
  originals.forEach((o, file) => {
    const cols = oCols[file]
    for (const row of o.rows) {
      const key = keyCols.map((k) => normKeyValue(k, row[cols.get(k)!])).join('\u0001')
      if (!index.has(key)) index.set(key, [])
      index.get(key)!.push({ file, row, used: false })
    }
  })

  const fixes = new Map<string, RestoreFix>()
  const fix = (column: string, line: number, from: string, to: string) => {
    let f = fixes.get(column)
    if (!f) fixes.set(column, (f = { column, count: 0, examples: [] }))
    f.count++
    if (f.examples.length < 5) f.examples.push(`${line}행: ${from} → ${to}`)
  }
  const unmatched: number[] = []
  const fileVotes = originals.map(() => 0)
  const dAddr = dCols.get('ADDR')

  const rows = damaged.rows.map((dRow, i) => {
    const line = damaged.lineNumbers[i] ?? i + 2
    const out = [...dRow]
    const key = keyCols.map((k) => normKeyValue(k, dRow[dCols.get(k)!])).join('\u0001')
    const candidates = (index.get(key) ?? []).filter((c) => !c.used)
    let best: OriginalRow | null = null
    let bestScore = -1
    for (const c of candidates) {
      const cols = oCols[c.file]
      const val = (k: string) => (cols.has(k) ? c.row[cols.get(k)!] ?? '' : null)
      const dv = (k: string) => (dCols.has(k) ? dRow[dCols.get(k)!] ?? '' : null)
      let score = 0
      const tilt = val('TILT')
      const dTilt = dv('TILT')
      if (tilt !== null && dTilt !== null && (tilt === dTilt || isExcelDamage(tilt, dTilt))) score += 8
      const cue = val('CUE')
      const dCue = dv('CUE')
      if (cue !== null && dCue !== null && sameNumber(cue, dCue)) score += 4
      const addr = val('ADDR')
      const dAd = dv('ADDR')
      if (addr && dAd && sameAddress(addr, dAd)) score += 2
      const type = val('TYPE')
      const dType = dv('TYPE')
      if (type !== null && dType !== null && type.trim().toLowerCase() === dType.trim().toLowerCase()) score += 1
      const hh = val('HH')
      const dHh = dv('HH')
      if (hh !== null && dHh !== null && sameNumber(hh, dHh)) score += 1
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }

    if (!best) {
      unmatched.push(line)
      if (dAddr !== undefined) {
        const repaired = repairAddress(out[dAddr])
        if (repaired !== out[dAddr]) {
          fix(damaged.headers[dAddr], line, out[dAddr], repaired)
          out[dAddr] = repaired
        }
      }
      return out
    }
    best.used = true
    fileVotes[best.file]++
    const cols = oCols[best.file]
    damaged.headers.forEach((h, j) => {
      const oj = cols.get(normalizeHeader(h))
      const orig = oj === undefined ? undefined : best!.row[oj] ?? ''
      const padded = orig === undefined ? null : padLike(orig, out[j] ?? '')
      if (orig !== undefined && isExcelDamage(orig, out[j] ?? '')) {
        fix(h, line, out[j], orig)
        out[j] = orig
      } else if (padded) {
        // 값은 사람이 바꿨고(HH 이동 등) 앞자리 0만 엑셀이 지운 경우
        fix(h, line, out[j], padded)
        out[j] = padded
      } else if (j === dAddr && !(orig ?? '').trim()) {
        // 주소 없는 디자인 원본: 원본에서 가져올 수 없으니 자릿수만 되돌린다
        const repaired = repairAddress(out[j])
        if (repaired !== out[j]) {
          fix(h, line, out[j], repaired)
          out[j] = repaired
        }
      }
    })
    return out
  })

  const topFile = fileVotes.indexOf(Math.max(...fileVotes))
  const encoding = originals.length && fileVotes[topFile] > 0 ? originals[topFile].encoding : damaged.encoding
  const csv: ParsedCsv = { ...damaged, encoding, rows }

  const issues: Issue[] = []
  if (unmatched.length) {
    issues.push({
      code: 'RESTORE_UNMATCHED',
      severity: 'warning',
      message: '원본에서 같은 행을 찾지 못해 그대로 둔 행이 있습니다. 원본 파일이 맞는지, 디자인을 바꾼 뒤 내보낸 파일인지 확인하세요.',
      count: unmatched.length,
      lines: unmatched.slice(0, 20)
    })
  }
  const suspicious = damagedSeriesLines(csv)
  if (suspicious.length) {
    issues.push({
      code: 'RESTORE_STILL_DAMAGED',
      severity: 'warning',
      message: '복원 후에도 직렬 TILT가 엑셀에서 계산된 값으로 남은 행이 있습니다.',
      count: suspicious.length,
      details: suspicious.slice(0, 10)
    })
  }
  return {
    csv,
    total: damaged.rows.length,
    matched: damaged.rows.length - unmatched.length,
    fixes: [...fixes.values()].sort((a, b) => b.count - a.count),
    unmatched,
    issues
  }
}

/** QTY > 1인데 TILT가 발 수만큼 없는 행 (엑셀이 "-40-40"을 계산해 버린 흔적) */
export function damagedSeriesLines(csv: ParsedCsv): string[] {
  const cols = columnIndex(csv.headers)
  const q = cols.get('QTY')
  const t = cols.get('TILT')
  if (q === undefined || t === undefined) return []
  const out: string[] = []
  csv.rows.forEach((r, i) => {
    const qty = Number(r[q])
    if (!(qty > 1)) return
    if (parseTilts(r[t] ?? '', qty).estimated) out.push(`${csv.lineNumbers[i] ?? i + 2}행: QTY=${qty}, TILT=${r[t]}`)
  })
  return out
}
