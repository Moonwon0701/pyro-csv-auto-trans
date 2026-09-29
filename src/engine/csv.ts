import Papa from 'papaparse'
import iconv from 'iconv-lite'
import { columnKeyOf } from './columns'
import type { ParsedCsv } from './types'

export function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: iconv.decode(Buffer.from(bytes), 'cp949'), encoding: 'CP949' }
  }
}

/** 앞쪽 제목 줄이 있을 수 있으므로, 인식 가능한 컬럼이 3개 이상이고 POS 또는 HH를 포함한 첫 행을 헤더로 본다 */
function findHeaderRow(data: string[][]): number {
  const limit = Math.min(data.length, 30)
  for (let i = 0; i < limit; i++) {
    const keys = data[i].map(columnKeyOf).filter(Boolean)
    if (keys.length >= 3 && (keys.includes('POS') || keys.includes('HH'))) return i
  }
  return data.findIndex((r) => r.some((c) => c.trim() !== ''))
}

export function parseCsv(bytes: Uint8Array, fileName: string): ParsedCsv {
  const { text, encoding } = decodeCsv(bytes)
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false })
  const data = result.data.map((r) => r.map((c) => (c ?? '').toString()))
  const headerIdx = findHeaderRow(data)
  if (headerIdx < 0) {
    return { fileName, encoding, headers: [], rows: [], lineNumbers: [] }
  }
  const headers = data[headerIdx].map((h) => h.trim())
  const rows: string[][] = []
  const lineNumbers: number[] = []
  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i]
    if (r.every((c) => c.trim() === '')) continue
    const padded = headers.map((_, j) => r[j] ?? '')
    rows.push(padded)
    lineNumbers.push(i + 1)
  }
  return { fileName, encoding, headers, rows, lineNumbers }
}
