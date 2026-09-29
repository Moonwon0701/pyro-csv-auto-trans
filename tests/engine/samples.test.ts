/**
 * samples/expected/<CSV 이름>.json (GPT/수작업 결과를 변환한 것)과 엔진 결과를 비교하는 회귀 테스트.
 * samples/는 git에 올리지 않으므로 파일이 없으면 건너뛴다.
 * <이름>.meta.json: { resolutions: 미등록 Prefix 분류, ordered: 행 순서까지 비교할지 }
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, parseCsv, transform, type RuleSet } from '../../src/engine'

const DIR = 'samples/expected'
const RULES: RuleSet = JSON.parse(readFileSync('rules/rules.json', 'utf8'))
const cases = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')) : []
const POS_COL = /^[PCS]-\d+$/
const EMPTY_TEXT = '해당 분류 데이터 없음'

interface ExpectedSheet {
  name: string
  columns: string[]
  rows: string[][]
}

/** 시간·CUE는 숫자로 비교 (GPT 결과는 0, 우리는 00) */
const norm = (col: string, v: string) => (/^(CUE|HH|MM|SS|FF)$/.test(col) && /^\d+$/.test(v) ? String(Number(v)) : v.trim())

describe.skipIf(cases.length === 0)('실제 샘플 회귀 테스트', () => {
  for (const f of cases) {
    const base = f.replace(/\.json$/, '')
    it(base, () => {
      const expected: ExpectedSheet[] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
      const metaPath = `${DIR}/${base}.meta.json`
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : { resolutions: {}, ordered: true }
      const csv = parseCsv(readFileSync(`samples/${base}.csv`), `${base}.csv`)
      const { analysis, sheets } = transform(csv, RULES, meta.resolutions, DEFAULT_OPTIONS)
      expect(analysis.blocked).toBe(false)
      const hasAddress = analysis.addressSummary.dominant !== '없음'

      for (const e of expected) {
        const s = sheets.find((x) => x.name === e.name)
        expect(s, `시트 ${e.name}`).toBeDefined()
        const erows = e.rows.filter((r) => r.some((v) => v) && r[0] !== EMPTY_TEXT)
        expect(s!.rows.length, `${e.name} 그룹 수`).toBe(erows.length)

        // 주소가 없는 원본이면 위치 열은 비교하지 않는다
        const common = e.columns.filter((c) => c && s!.columns.includes(c) && (hasAddress || !POS_COL.test(c)))
        const rowText = (get: (c: string) => string) => common.filter((c) => c !== 'CUE').map((c) => `${c}=${norm(c, get(c))}`).join(' | ')
        const exp = erows.map((r) => rowText((c) => r[e.columns.indexOf(c)] ?? ''))
        const ours = s!.rows.map((r) => rowText((c) => r[s!.columns.indexOf(c)].value))
        if (meta.ordered) expect(ours, e.name).toEqual(exp)
        else expect([...ours].sort(), e.name).toEqual([...exp].sort())
      }
    })
  }
})
