import { useEffect, useRef, useState } from 'react'
import type { Resolution } from '@engine/types'
import type { LabelRun, LabelSource } from '../../preload'
import IssueItem from './IssueItem'
import SheetPreview from './SheetPreview'
import { TutorialBanner } from './Tutorial'

interface Props {
  active: boolean
  /** ③ 시트 정리에서 넘어온 파일 */
  incoming: LabelSource | null
  /** ①에서 이번 작업에만 쓰기로 고른 접두어 분류 */
  presetResolutions: Record<string, Resolution>
  rulesRev: number
  onBack?: () => void
  /** 직렬 TILT가 깨졌을 때 복원하러 가기 */
  onOpenTools: () => void
  tutorial: boolean
  onExitTutorial: () => void
}

/**
 * ④ 라벨 만들기: CSV를 타상·연발·단발 라벨 시트로 나눈 엑셀과 폼텍 DesignPro 패키지(.dgz)를 만든다.
 * dgz를 더블클릭하면 DesignPro가 라벨 디자인과 데이터를 함께 연다.
 */
export default function LabelView({ active, incoming, presetResolutions, rulesRev, onBack, onOpenTools, tutorial, onExitTutorial }: Props) {
  const [file, setFile] = useState<LabelSource | null>(null)
  const [showName, setShowName] = useState('')
  const [run, setRun] = useState<LabelRun | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string; path?: string }>({ kind: '', text: '' })
  /** 지금 라벨을 만드는 데이터의 경로 (③을 따라가다 바뀌는지 본다) */
  const sourcePath = useRef('')

  useEffect(() => {
    if (incoming) load(Promise.resolve(incoming))
  }, [incoming])

  useEffect(() => {
    window.api.onLabelsOpened((f) => load(Promise.resolve(f)))
  }, [])

  // ③에서 넘겨받은 파일은 ③에 지금 열린 데이터를 따라가므로 ④에 들어올 때마다 다시 만든다
  useEffect(() => {
    if (!file || !active) return
    let cancelled = false
    window.api
      .labelsRun(presetResolutions)
      .then((r) => {
        if (cancelled) return
        // ③에서 다른 공연 파일을 열었으면 행사명도 그 파일 것으로
        if (r.source.path !== sourcePath.current) setShowName(r.source.showName)
        sourcePath.current = r.source.path
        setRun(r)
      })
      .catch((e) => !cancelled && setStatus({ kind: 'err', text: String(e.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [file, presetResolutions, rulesRev, active])

  useEffect(() => {
    if (!active) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) load(window.api.labelsOpen(window.api.pathsOf([f])[0]))
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [active])

  function load(p: Promise<LabelSource | null>) {
    p.then((f) => {
      if (!f) return
      sourcePath.current = f.path
      setFile(f)
      setShowName(f.showName)
      setRun(null)
      setStatus({ kind: '', text: '' })
    }).catch((e) => setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${e.message ?? e}` }))
  }

  async function save() {
    setBusy(true)
    setStatus({ kind: '', text: '라벨 파일 만드는 중…' })
    try {
      const r = await window.api.labelsSave(presetResolutions, showName)
      if (!r) return setStatus({ kind: '', text: '저장을 취소했습니다.' })
      setStatus({ kind: 'ok', text: `${r.files.length}개 파일을 만들었습니다 (라벨작업 xlsx + dgz ${r.files.length - 1}개)`, path: r.files[0] })
    } catch (e) {
      setStatus({ kind: 'err', text: String((e as Error).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  if (!file) {
    return (
      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onClick={() => load(window.api.labelsPick())}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
      >
        <div className="icon">🏷️</div>
        <h2>④ 라벨 만들기</h2>
        <p>
          주소가 매겨진 CSV를 끌어다 놓거나 클릭해서 여세요. ③ 시트 정리에서 “④ 라벨 만들기 →”를 눌러도 됩니다.
          <br />
          타상·연발·단발로 나눈 라벨작업 엑셀과 폼텍 DesignPro용 <b>.dgz</b> 파일을 만듭니다.
        </p>
        {status.kind === 'err' && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{status.text}</p>}
      </div>
    )
  }

  const source = run?.source ?? file
  const damaged = run?.issues.some((i) => i.code === 'LABEL_TILT_DAMAGED')
  const total = run?.counts.reduce((n, c) => n + c.labels, 0) ?? 0

  return (
    <>
      {tutorial &&
        (status.kind === 'ok' ? (
          <TutorialBanner step="완료" onExit={onExitTutorial}>
            🎉 끝! <b>폴더 열기</b>로 라벨작업 xlsx와 dgz를 확인해 보세요. dgz를 더블클릭하면 폼텍 DesignPro로 열려요. 이제 실제 CSV로 똑같이 하면 됩니다.
          </TutorialBanner>
        ) : (
          <TutorialBanner step="4/4" onExit={onExitTutorial}>
            왼쪽에서 <b>행사명</b>과 분류별 <b>라벨 수</b>를 확인하고(오른쪽은 라벨 시트 미리보기), 아래 <b>라벨 파일 만들기</b>를 누르세요.
          </TutorialBanner>
        ))}
      <div className="work">
        <div className="side">
          <div className="card file-card">
            <div style={{ flex: 1 }}>
              <div className="name">{source.fileName}</div>
              <div className="meta">
                {source.rows.toLocaleString()}행 · {source.encoding}
                {source.fromConvert && ' · ③ 시트 정리와 같은 데이터'}
              </div>
            </div>
            <button className="btn small" onClick={() => load(window.api.labelsPick())}>
              다른 파일
            </button>
          </div>

          <div className="card">
            <h3>행사명</h3>
            <input className="input" style={{ width: '100%' }} value={showName} onChange={(e) => setShowName(e.target.value)} />
            <p className="hint" style={{ marginBottom: 0 }}>
              라벨마다 찍히고 dgz 파일 이름에도 들어갑니다. 예: <span className="mono">{showName || '울주'} 단발.dgz</span>
            </p>
          </div>

          {run && (
            <div className="card">
              <h3>라벨 수</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>분류</th>
                    <th className="num">CSV 행</th>
                    <th className="num">라벨</th>
                    <th>만들 파일</th>
                  </tr>
                </thead>
                <tbody>
                  {run.counts.map((c) => (
                    <tr key={c.category}>
                      <td>
                        <span className={`cat ${c.category}`}>{c.category}</span>
                      </td>
                      <td className="num">{c.sourceRows}</td>
                      <td className="num">
                        {c.labels}
                        {c.labels > c.sourceRows && <span className="hint"> (직렬 +{c.labels - c.sourceRows})</span>}
                      </td>
                      <td className="mono">{c.labels ? `${showName} ${c.category}.dgz` : <span className="hint">없음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint" style={{ marginBottom: 0 }}>
                직렬(한 핀에 여러 발)은 발마다 라벨 한 장. 각도는 왼쪽(−)=CUSTOM1, 수직(90)=CUSTOM2, 오른쪽(+)=CUSTOM3. 타상 직렬은 제품명 뒤에 “2직”, 체인은
                “3초 체인”.
              </p>
            </div>
          )}

          <div className="card">
            <h3>검증 결과</h3>
            {!run || run.issues.length === 0 ? <div className="ok-line">문제 없음 ✓</div> : run.issues.map((i) => <IssueItem key={i.code} issue={i} />)}
            {damaged && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={onOpenTools}>
                  파일 도구 → 엑셀 손상 복원 열기
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h3>인쇄</h3>
            <p className="hint" style={{ margin: 0 }}>
              만든 <b>.dgz</b>를 더블클릭하면 폼텍 DesignPro 9가 라벨 디자인(3100 라벨지)과 라벨작업 엑셀을 함께 엽니다. 디자인은 울주 라벨과 같습니다.
            </p>
          </div>
        </div>

        <div className="main">{run && <SheetPreview sheets={run.sheets} />}</div>
      </div>

      <div className="actionbar">
        {onBack && (
          <button className="btn big" onClick={onBack}>
            ← ③ 시트 정리
          </button>
        )}
        <div className={`status ${status.kind}`}>
          {status.text || (run ? `라벨 ${total.toLocaleString()}장 · 폴더를 고르면 라벨작업 xlsx와 dgz를 만듭니다.` : '분석 중…')}
          {status.path && (
            <button className="btn link" style={{ marginLeft: 10 }} onClick={() => window.api.showItem(status.path!)}>
              폴더 열기
            </button>
          )}
        </div>
        <button className="btn primary big" disabled={!run || busy || total === 0 || !showName.trim()} onClick={save}>
          라벨 파일 만들기
        </button>
      </div>
    </>
  )
}
