import { existsSync, readFileSync } from 'fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDgz, dgzDataPath, patchDgf, readDgf, TEMPLATE_SHOW_NAME } from '../../src/engine'

const TEMPLATES = ['타상', '연발', '단발'] as const
const template = (c: string) => new Uint8Array(readFileSync(`resources/label-templates/${c}.dgf`))
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

describe('라벨 디자인 템플릿 (.dgf)', () => {
  for (const c of TEMPLATES) {
    it(`${c}: 시트 연결·자리표시·끝부분 크기`, () => {
      const t = template(c)
      const info = readDgf(t)
      expect(info.sheet).toBe(`[${c}$]`)
      expect(info.dataPath).toBe(`C:\\Users\\User\\Documents\\Formtec\\DesignPro9\\Temp\\${TEMPLATE_SHOW_NAME} ${c}\\Data\\라벨작업_FD01.XLSX`)
      expect(info.trailer).toBe(t.length - 325)
    })
  }

  it('행사명·경로를 바꾸면 길이와 끝부분 크기가 함께 바뀐다', () => {
    const t = template('단발')
    const path = dgzDataPath('C:/Users/홍길동/OneDrive/문서/', '2026 부산 단발', '2026 부산 라벨작업')
    expect(path).toBe('C:\\Users\\홍길동\\OneDrive\\문서\\Formtec\\DesignPro9\\Temp\\2026 부산 단발\\Data\\2026 부산 라벨작업_FD01.XLSX')
    const out = patchDgf(t, { dataPath: path, showName: '부산불꽃축제' })
    const info = readDgf(out)
    expect(info.dataPath).toBe(path)
    expect(info.sheet).toBe('[단발$]')
    expect(info.trailer).toBe(out.length - 325)
    const text = Buffer.from(out).toString('utf16le')
    expect(text.includes('부산불꽃축제')).toBe(true)
    expect(text.includes(TEMPLATE_SHOW_NAME)).toBe(false)
  })
})

/** 울주 원본 dgf: 원래 경로·행사명으로 다시 패치하면 바이트가 같아야 한다 (패치가 다른 곳을 건드리지 않는다는 증거) */
const U = 'samples/2026-10-06-02'
describe.skipIf(!existsSync(`${U}/울주 단발.dgz`))('울주 dgz 재현', () => {
  for (const c of TEMPLATES) {
    it(c, async () => {
      const zip = await JSZip.loadAsync(readFileSync(`${U}/울주 ${c}.dgz`))
      const dgf = await Object.values(zip.files).find((f) => f.name.endsWith('.dgf'))!.async('uint8array')
      const { dataPath } = readDgf(dgf)
      expect(patchDgf(template(c), { dataPath, showName: '울주' })).toEqual(dgf)
    })
  }
})

describe('dgz 패키지', () => {
  it('폼텍과 같은 zip 구성 (CP949 이름 + Unicode Path, UTF-8 플래그 없음)', async () => {
    const xlsx = new Uint8Array([1, 2, 3, 4])
    const out = await buildDgz({
      xlsx,
      xlsxBase: '260725 울주 라벨작업',
      dgzBase: '울주 단발',
      template: template('단발'),
      documentsDir: 'C:\\Users\\Master\\Documents',
      showName: '울주'
    })
    // 중앙 디렉터리 항목을 직접 읽는다
    const names: { raw: string; flag: number; extra: number }[] = []
    for (let i = 0; i < out.length - 4; i++) {
      if (u32(out, i) !== 0x02014b50) continue
      const flag = out[i + 8] | (out[i + 9] << 8)
      const n = out[i + 28] | (out[i + 29] << 8)
      const m = out[i + 30] | (out[i + 31] << 8)
      names.push({ raw: new TextDecoder('euc-kr').decode(out.subarray(i + 46, i + 46 + n)), flag, extra: out[i + 46 + n] | (out[i + 47 + n] << 8) })
      i += 45 + n + m
    }
    expect(names).toEqual([
      { raw: 'Data/260725 울주 라벨작업_FD01.XLSX', flag: 0, extra: 0x7075 },
      { raw: 'Design/울주 단발.dgf', flag: 0, extra: 0x7075 }
    ])
    const zip = await JSZip.loadAsync(out)
    expect(await zip.file('Data/260725 울주 라벨작업_FD01.XLSX')!.async('uint8array')).toEqual(xlsx)
    const dgf = await zip.file('Design/울주 단발.dgf')!.async('uint8array')
    expect(readDgf(dgf).dataPath).toBe('C:\\Users\\Master\\Documents\\Formtec\\DesignPro9\\Temp\\울주 단발\\Data\\260725 울주 라벨작업_FD01.XLSX')
  })
})
