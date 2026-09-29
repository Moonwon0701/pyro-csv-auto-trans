/**
 * 사람이 주소를 매긴 실제 파일로 주소 배정 규칙을 검증한다 (samples/는 git 제외, 없으면 건너뜀).
 * 주소를 지운 뒤, 각 위치의 실제 시작 주소만 알려주고 다시 매겨서 원본과 비교한다.
 * 100%가 안 되는 부분은 디자인 수정 후 끝에 덧붙인 주소 등 수작업 흔적이라 규칙으로 재현할 수 없다.
 */
import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { addressToIndex, assignAddresses, indexToAddress, parseCsv, type ParsedCsv, type SortMode } from '../../src/engine'

const S = 'samples/sets/시트정리 공유'
const D = 'samples/data'
const ALL: { name: string; path: string; mode: SortMode; min: number }[] = [
  { name: '거제 FC-01', path: `${S}/260614 거제옥포대첩/FC-01.csv`, mode: 'time', min: 1 },
  { name: '통영 FC-01', path: `${S}/260314 통영요트폐막/FC-01.csv`, mode: 'time', min: 0.77 },
  { name: '거제 FC-02', path: `${S}/260614 거제옥포대첩/FC-02.csv`, mode: 'effect', min: 0.67 },
  { name: '울주', path: `${S}/260725 울주해양레포츠/FC-01.csv`, mode: 'effect', min: 0.9 },
  { name: '퐁피두', path: `${S}/260904 퐁피두/FC-01.csv`, mode: 'effect', min: 0.83 },
  { name: '방위', path: `${D}/25방위/ADD.csv`, mode: 'effect', min: 0.9 },
  { name: '화순', path: `${D}/25화순/ADD.csv`, mode: 'effect', min: 0.9 },
  { name: '하이원 8월', path: `${D}/25하이원_8월/ADD.csv`, mode: 'effect', min: 0.9 },
  { name: '하이원 12월', path: `${D}/25하이원_12월/ADD.csv`, mode: 'effect', min: 0.9 }
]
const CASES = ALL.filter((c) => existsSync(c.path))

function col(csv: ParsedCsv, name: string) {
  return csv.headers.findIndex((h) => h.trim().toUpperCase() === name)
}

describe.skipIf(CASES.length === 0)('주소 배정: 사람이 매긴 결과 재현', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const original = parseCsv(readFileSync(c.path), c.name)
      const [ai, pi, ci] = [col(original, 'ADDR'), col(original, 'POS'), col(original, 'CONTROL')]
      // 위치별 실제 주소 (연속 범위인 위치만 비교 대상)
      const byPos = new Map<string, number[]>()
      original.rows.forEach((r) => {
        const k = `${r[ci] ?? ''}\u0000${r[pi]}`
        if (!byPos.has(k)) byPos.set(k, [])
        byPos.get(k)!.push(addressToIndex(r[ai])!)
      })
      const contiguous = [...byPos].filter(([, xs]) => {
        const s = [...xs].sort((a, b) => a - b)
        return new Set(s).size === s.length && s[s.length - 1] - s[0] === s.length - 1
      })
      const plan = contiguous.map(([k, xs]) => {
        const [control, pos] = k.split('\u0000')
        return { control, pos, ranges: indexToAddress(Math.min(...xs)) }
      })
      const stripped: ParsedCsv = { ...original, rows: original.rows.map((r) => r.map((v, i) => (i === ai ? '' : v))) }
      const result = assignAddresses(stripped, { sortMode: c.mode, plan })
      let total = 0
      let same = 0
      const keys = new Set(contiguous.map(([k]) => k))
      original.rows.forEach((r, i) => {
        if (!keys.has(`${r[ci] ?? ''}\u0000${r[pi]}`)) return
        total++
        if (addressToIndex(result.csv.rows[i][ai]) === addressToIndex(r[ai])) same++
      })
      const rate = same / total
      console.log(`${c.name}: 연속 범위 위치 ${contiguous.length}/${byPos.size}개, ${same}/${total}행 일치 (${(rate * 100).toFixed(1)}%)`)
      expect(rate).toBeGreaterThanOrEqual(c.min)
    })
  }
})

