/**
 * 테스트용: xlsx 첫 시트의 셀 값을 읽는다.
 * 샘플 레이아웃은 한컴오피스(HCell)로 저장되어 태그에 x: 접두어가 붙고 exceljs가 열지 못해서 XML을 직접 읽는다.
 */
import JSZip from 'jszip'

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const texts = (s: string) => [...s.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')

export async function firstSheetCells(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes)
  const read = async (path: string) => ((await zip.file(path)?.async('string')) ?? '').replace(/<(\/?)x:/g, '<$1')
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]))
  const rels = await read('xl/_rels/workbook.xml.rels')
  const firstId = (await read('xl/workbook.xml')).match(/<sheet [^>]*r:id="([^"]+)"/)?.[1]
  const target = rels.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstId}"`))?.[1]
  const sheet = await read(`xl/${(target ?? 'worksheets/sheet1.xml').replace(/^\/?xl\//, '')}`)
  const cells = new Map<string, string>()
  for (const c of sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const type = c[2].match(/t="(\w+)"/)?.[1]
    const inner = c[3] ?? ''
    let v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    if (type === 's') v = shared[Number(v)]
    else if (type === 'inlineStr') v = texts(inner)
    else if (v !== undefined) v = decode(v)
    if (v !== undefined && v !== '') cells.set(c[1], v)
  }
  return cells
}
