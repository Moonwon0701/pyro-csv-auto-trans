import { useEffect, useMemo, useState } from 'react'
import type { AssignOptions, AssignPlanEntry, SortMode } from '@engine/assign'
import type { Issue } from '@engine/types'
import type { AssignRun, AssignSource, OpenedFile } from '../../preload'
import { TutorialBanner } from './Tutorial'

interface Props {
  active: boolean
  tutorial: boolean
  onExitTutorial: () => void
  /** 튜토리얼 샘플 등 밖에서 열어준 원본 */
  incoming: AssignSource | null
  /** 주소를 매긴 결과를 시트 정리 화면으로 넘긴다 */
  onSendToConvert: (f: OpenedFile) => void
}

const keyOf = (control: string, pos: string) => `${control}\u0000${pos}`

export default function AssignView({ active, tutorial, onExitTutorial, incoming, onSendToConvert }: Props) {
  const [source, setSource] = useState<AssignSource | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('effect')
  const [startModule, setStartModule] = useState('01')
  const [ranges, setRanges] = useState<Record<string, string>>({})
  const [run, setRun] = useState<AssignRun | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string; path?: string }>({ kind: '', text: '' })

  const plan: AssignPlanEntry[] = useMemo(
    () => (source?.positions ?? []).map((p) => ({ control: p.control, pos: p.pos, ranges: ranges[keyOf(p.control, p.pos)] ?? '' })),
    [source, ranges]
  )
  const opts: AssignOptions = { sortMode, plan }

  useEffect(() => {
    if (incoming) load(Promise.resolve(incoming))
  }, [incoming])

  useEffect(() => {
    window.api.onAssignOpened((s) => load(Promise.resolve(s)))
  }, [])

  useEffect(() => {
    if (!active) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) load(window.api.assignOpenDropped(f))
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [active])

  // 계획이 바뀌면 미리 계산
  useEffect(() => {
    if (!source) return
    let cancelled = false
    window.api
      .assignRun({ sortMode, plan })
      .then((r) => !cancelled && setRun(r))
      .catch((e) => !cancelled && setStatus({ kind: 'err', text: String(e.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [source, sortMode, plan])

  function load(p: Promise<AssignSource | null>) {
    p.then(async (s) => {
      if (!s) return
      setSource(s)
      setRun(null)
      setStatus({ kind: '', text: '' })
      await propose(startModule)
    }).catch((e) => setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${e.message ?? e}` }))
  }

  async function propose(start: string) {
    const proposed = await window.api.assignPropose(start)
    setRanges(Object.fromEntries(proposed.map((p) => [keyOf(p.control, p.pos), p.ranges])))
  }

  async function act(kind: 'save' | 'convert') {
    setBusy(true)
    try {
      if (kind === 'save') {
        const path = await window.api.assignSave(opts)
        setStatus(path ? { kind: 'ok', text: '주소 매긴 CSV를 저장했습니다.', path } : { kind: '', text: '저장을 취소했습니다.' })
      } else {
        onSendToConvert(await window.api.assignToConvert(opts))
      }
    } catch (e) {
      setStatus({ kind: 'err', text: String((e as Error).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  if (!source) {
    return (
      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onClick={() => load(window.api.assignPick())}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
      >
        <div className="icon">🔢</div>
        <h2>주소를 매길 원본 CSV를 끌어다 놓으세요</h2>
        <p>ADDR이 비어 있는 디자인 CSV에 FM-A 주소(예: 1F0)를 위치별로 겹치지 않게 채웁니다</p>
        {status.kind === 'err' && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{status.text}</p>}
      </div>
    )
  }

  const summaryOf = new Map((run?.summary ?? []).map((s) => [keyOf(s.control, s.pos), s]))
  const controls = [...new Set(source.positions.map((p) => p.control))]
  const totalNeeded = source.positions.reduce((n, p) => n + p.needed, 0)
  const totalExisting = source.positions.reduce((n, p) => n + p.assigned, 0)

  return (
    <>
      {tutorial && (
        <TutorialBanner step="1/3" onExit={onExitTutorial}>
          위치(POS)마다 주소 범위가 <b>자동으로 제안</b>됐어요. 오른쪽 표에서 위치별 범위와 배정 결과를 훑어본 뒤, 아래{' '}
          <b>바로 시트 정리 →</b>를 누르세요.
        </TutorialBanner>
      )}
      <div className="work">
        <div className="side">
          <div className="card file-card">
            <div style={{ flex: 1 }}>
              <div className="name">{source.fileName}</div>
              <div className="meta">
                {source.rows.toLocaleString()}행 · {source.encoding} · 새로 매길 행 {totalNeeded.toLocaleString()}
                {totalExisting > 0 && ` · 기존 주소 ${totalExisting.toLocaleString()} (유지)`}
              </div>
            </div>
            <button className="btn small" onClick={() => load(window.api.assignPick())}>
              다른 파일
            </button>
          </div>

          <div className="card">
            <h3>배정 방식</h3>
            <label className="opt">
              위치 안의 순서
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                <option value="effect">효과순 (Effect 알파벳순 → 시간순)</option>
                <option value="time">시간순</option>
              </select>
            </label>
            <label className="opt">
              자동 배정 시작 모듈
              <input
                className="input mono"
                style={{ width: 70 }}
                value={startModule}
                maxLength={2}
                onChange={(e) => setStartModule(e.target.value.toUpperCase())}
              />
            </label>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn small" onClick={() => propose(startModule)}>
                자동 배정 다시 하기
              </button>
            </div>
            <p className="hint">
              자동 배정은 Control마다 시작 모듈부터, 위치마다 새 모듈에서 시작해 필요한 만큼 이어서 잡습니다. 오른쪽 표에서 위치별 범위를 직접 고칠 수
              있습니다. 예: <span className="mono">210</span> (여기서부터), <span className="mono">210-22F</span>,{' '}
              <span className="mono">01F-01F, 110</span> (여러 범위).
            </p>
            <p className="hint">FM-A 규칙: 모듈 00과 xE(0E, 1E…)는 건너뜁니다. 이미 주소가 있는 행은 그대로 두고 그 주소는 다시 쓰지 않습니다.</p>
          </div>

          <div className="card">
            <h3>검증 결과</h3>
            {!run || run.issues.length === 0 ? (
              <div className="ok-line">문제 없음 ✓</div>
            ) : (
              run.issues.map((i, n) => <IssueLine key={n} issue={i} />)
            )}
          </div>
        </div>

        <div className="main">
          <div className="preview">
            <div className="table-wrap">
              <table className="grid assign">
                <thead>
                  <tr>
                    {controls.length > 1 || controls[0] ? <th>Control</th> : null}
                    <th>POS</th>
                    <th>분류</th>
                    <th className="num">행</th>
                    <th className="num">기존</th>
                    <th className="num">필요</th>
                    <th>주소 범위</th>
                    <th>배정 결과</th>
                  </tr>
                </thead>
                <tbody>
                  {source.positions.map((p) => {
                    const k = keyOf(p.control, p.pos)
                    const s = summaryOf.get(k)
                    return (
                      <tr key={k}>
                        {controls.length > 1 || controls[0] ? <td>{p.control}</td> : null}
                        <td className="mono">{p.pos}</td>
                        <td>{p.category ? <span className={`cat ${p.category}`}>{p.category}</span> : <span className="hint">—</span>}</td>
                        <td className="num">{p.rows}</td>
                        <td className="num">{p.assigned || ''}</td>
                        <td className="num">{p.needed || ''}</td>
                        <td>
                          {p.needed > 0 ? (
                            <input
                              className={`input mono ${s?.error ? 'bad' : ''}`}
                              style={{ width: 170 }}
                              value={ranges[k] ?? ''}
                              onChange={(e) => setRanges((r) => ({ ...r, [k]: e.target.value.toUpperCase() }))}
                            />
                          ) : (
                            <span className="hint">모두 주소 있음</span>
                          )}
                        </td>
                        <td className="mono">
                          {s?.error ? <span style={{ color: 'var(--danger)' }}>{s.error}</span> : s ? s.range : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="actionbar">
        <div className={`status ${status.kind}`}>
          {status.text || (run?.blocked ? '주소 범위를 고쳐야 저장할 수 있습니다.' : `${source.positions.length}개 위치에 주소를 매깁니다.`)}
          {status.path && (
            <button className="btn link" style={{ marginLeft: 10 }} onClick={() => window.api.showItem(status.path!)}>
              폴더 열기
            </button>
          )}
        </div>
        <button className="btn big" disabled={!run || run.blocked || busy} onClick={() => act('save')}>
          주소 CSV 저장
        </button>
        <button className="btn primary big" disabled={!run || run.blocked || busy} onClick={() => act('convert')}>
          바로 시트 정리 →
        </button>
      </div>
    </>
  )
}

function IssueLine({ issue }: { issue: Issue }) {
  if (!issue.details?.length) return <div className={`issue ${issue.severity}`}>{issue.message}</div>
  return (
    <details className={`issue ${issue.severity}`}>
      <summary>{issue.message}</summary>
      <div className="detail">{issue.details.join(', ')}</div>
    </details>
  )
}
