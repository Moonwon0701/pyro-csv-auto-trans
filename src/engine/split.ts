/**
 * CSV를 열 값(CONTROL, CUSTOM4의 FC, HH 구간 …)별로 나눈다. 엑셀을 거치지 않으므로 직렬 TILT·주소 앞자리 0이 그대로 남는다.
 */
import { normalizeHeader } from './columns'
import type { ParsedCsv } from './types'

export interface SplitOptions {
  /** 나눌 기준 열 (헤더 이름) */
  by: string
  /** 결과에서 지울 열 (헤더 이름, 예: PFT) */
  dropColumns: string[]
  /** 파일마다 가장 이른 HH를 0으로 당긴다 (통합 파일의 HH=1 구간 → 구간 파일 HH=0) */
  resetHH: boolean
}

export interface SplitPart {
  /** 기준 열 값 (비어 있으면 EMPTY_SPLIT_KEY) */
  key: string
  csv: ParsedCsv
}

export const EMPTY_SPLIT_KEY = '(빈 값)'

/** 시간·주소·제품 정보처럼 나눌 기준이 될 일이 없는 열 */
const NOT_SPLIT_KEYS = new Set(['CUE', 'MM', 'SS', 'FF', 'ADDR', 'MODULE', 'PIN', 'POS', 'QTY', 'CAL', 'DUR', 'TYPE', 'PFT', 'REF', 'MFG', 'PRICE1', 'PAN', 'TILT', 'EFFECTDESCRIPTION', 'EVENTDESCRIPTION'])

/** 나눌 기준으로 쓸 만한 열: 서로 다른 값이 2~40개 (CONTROL·CUSTOM·HH를 앞에) */
export function splitCandidates(csv: ParsedCsv): { header: string; values: number }[] {
  const prefer = (h: string) => {
    const k = normalizeHeader(h)
    return k === 'CONTROL' ? 0 : /^CUSTOM\d$/.test(k) ? 1 : k === 'HH' ? 2 : 3
  }
  return csv.headers
    .map((header, i) => ({ header, values: new Set(csv.rows.map((r) => (r[i] ?? '').trim()).filter(Boolean)).size }))
    .filter((c) => c.header.trim() && !NOT_SPLIT_KEYS.has(normalizeHeader(c.header)) && c.values >= 2 && c.values <= 40)
    .sort((a, b) => prefer(a.header) - prefer(b.header))
}

const findColumn = (headers: string[], name: string) => {
  const k = normalizeHeader(name)
  return headers.findIndex((h) => normalizeHeader(h) === k)
}

/** 파일 이름에 못 쓰는 글자 */
export const safeFilePart = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim()

export function splitCsv(csv: ParsedCsv, opts: SplitOptions): SplitPart[] {
  const by = findColumn(csv.headers, opts.by)
  if (by < 0) throw new Error(`기준 열을 찾지 못했습니다: ${opts.by}`)
  const drop = new Set(opts.dropColumns.map((d) => findColumn(csv.headers, d)).filter((i) => i >= 0))
  const keep = csv.headers.map((_, i) => i).filter((i) => !drop.has(i))
  const hh = findColumn(csv.headers, 'HH')

  const groups = new Map<string, { rows: string[][]; lines: number[] }>()
  csv.rows.forEach((r, i) => {
    const key = (r[by] ?? '').trim() || EMPTY_SPLIT_KEY
    if (!groups.has(key)) groups.set(key, { rows: [], lines: [] })
    const g = groups.get(key)!
    g.rows.push(r)
    g.lines.push(csv.lineNumbers[i])
  })

  const base = csv.fileName.replace(/\.[^.]+$/, '')
  return [...groups.entries()].map(([key, g]) => {
    let rows = g.rows
    if (opts.resetHH && hh >= 0) {
      const hours = rows.map((r) => Number(r[hh])).filter((n) => Number.isFinite(n))
      const min = hours.length ? Math.min(...hours) : 0
      if (min > 0) {
        rows = rows.map((r) => {
          const v = (r[hh] ?? '').trim()
          if (!/^\d+$/.test(v)) return r
          const out = [...r]
          out[hh] = String(Number(v) - min).padStart(v.length, '0')
          return out
        })
      }
    }
    return {
      key,
      csv: {
        fileName: `${base} ${safeFilePart(key)}.csv`,
        encoding: csv.encoding,
        headers: keep.map((i) => csv.headers[i]),
        rows: rows.map((r) => keep.map((i) => r[i] ?? '')),
        lineNumbers: g.lines
      }
    }
  })
}
