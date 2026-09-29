export interface ParsedPosition {
  prefix: string
  number: number
}

/** "SCK-03" → { prefix: "SCK", number: 3 }. 마지막 '-' 뒤의 숫자를 위치번호로 본다 */
export function parsePosition(raw: string): ParsedPosition | null {
  const s = raw.trim()
  if (!s) return null
  const m = s.match(/^(.+?)\s*-\s*(\d+)$/) ?? s.match(/^(.*?[A-Za-z])(\d+)$/)
  if (!m) return null
  return { prefix: m[1].trim().toUpperCase(), number: parseInt(m[2], 10) }
}

export function formatPosition(outputPrefix: string, n: number): string {
  return `${outputPrefix}-${String(n).padStart(2, '0')}`
}
