import type { ColumnKey } from './types'

/** 헤더 정규화: 대문자 + 영숫자만 */
export function normalizeHeader(h: string): string {
  return h.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const ALIASES: Record<string, ColumnKey> = {
  CONTROL: 'CONTROL', CONTROLLER: 'CONTROL',
  CUE: 'CUE', CUENO: 'CUE', CUENUMBER: 'CUE',
  HH: 'HH', MM: 'MM', SS: 'SS', FF: 'FF',
  TYPE: 'TYPE',
  POS: 'POS', POSITION: 'POS',
  ADDR: 'ADDR', ADDRESS: 'ADDR',
  MODULE: 'MODULE', PIN: 'PIN',
  QTY: 'QTY', QUANTITY: 'QTY',
  REF: 'REF', MFG: 'MFG', PRICE1: 'PRICE1', PFT: 'PFT', PAN: 'PAN', TILT: 'TILT',
  EVENTDESCRIPTION: 'EVENT', EVENTDESC: 'EVENT',
  EFFECTDESCRIPTION: 'EFFECT', EFFECTDESC: 'EFFECT', EFFECT: 'EFFECT'
}

export function columnKeyOf(header: string): ColumnKey | undefined {
  return ALIASES[normalizeHeader(header)]
}

/** 표준 컬럼 키 → 헤더 인덱스. 같은 키가 여러 번 나오면 첫 번째를 사용 */
export function detectColumns(headers: string[]): Map<ColumnKey, number> {
  const map = new Map<ColumnKey, number>()
  headers.forEach((h, i) => {
    const key = columnKeyOf(h)
    if (key && !map.has(key)) map.set(key, i)
  })
  return map
}

/** 결과 시트에 그대로 옮겨 적는 부가 컬럼 (Spec 6.3 순서) */
export const PASSTHROUGH_BEFORE_EFFECT: ColumnKey[] = ['QTY', 'EVENT']
export const PASSTHROUGH_AFTER_EFFECT: ColumnKey[] = ['PAN', 'TILT']

/** 결과에 쓰이는 컬럼 (PFT, REF, MFG, PRICE1 등은 현장용 결과에서 제외) */
export const OUTPUT_KEYS: ColumnKey[] = [
  'CONTROL', 'CUE', 'HH', 'MM', 'SS', 'FF', 'TYPE', 'POS', 'ADDR', 'MODULE', 'PIN', 'EFFECT',
  ...PASSTHROUGH_BEFORE_EFFECT, ...PASSTHROUGH_AFTER_EFFECT
]

