/**
 * 폼텍 DesignPro dgz에서 라벨 디자인(.dgf)을 꺼내 앱 템플릿(resources/label-templates/<분류>.dgf)으로 저장한다.
 * 공개 저장소에 들어가므로 행사명·PC 경로는 자리표시로 바꾼다.
 *
 *   npx vite-node scripts/extract-dgf-template.ts -- "울주 단발.dgz" [템플릿 속 행사명=울주]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { dgzDataPath, patchDgf, readDgf, TEMPLATE_SHOW_NAME } from '../src/engine/dgz'

const OUT = 'resources/label-templates'

async function main() {
  const [file, showName = '울주'] = process.argv.slice(2).filter((a) => a !== '--')
  if (!file) throw new Error('사용법: extract-dgf-template.ts <파일.dgz> [템플릿 속 행사명]')
  const zip = await JSZip.loadAsync(readFileSync(file))
  const entry = Object.values(zip.files).find((f) => /\.dgf$/i.test(f.name))
  if (!entry) throw new Error('dgz 안에 .dgf가 없습니다.')
  const dgf = await entry.async('uint8array')
  const { sheet } = readDgf(dgf)
  const category = sheet.replace(/^\[|\$\]$/g, '')
  const template = patchDgf(dgf, {
    dataPath: dgzDataPath('C:\\Users\\User\\Documents', `${TEMPLATE_SHOW_NAME} ${category}`, '라벨작업'),
    showName: TEMPLATE_SHOW_NAME,
    templateShowName: showName
  })
  mkdirSync(OUT, { recursive: true })
  const out = join(OUT, `${category}.dgf`)
  writeFileSync(out, template)
  console.log(`${out}  (${sheet}, ${dgf.length} → ${template.length} bytes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
