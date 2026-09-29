import { useEffect, useMemo, useState } from 'react'
import {
  CATEGORIES,
  DEFAULT_OPTIONS,
  EXCLUDE,
  type Issue,
  type PositionRule,
  type Profile,
  type Resolution,
  type TransformOptions,
  type TransformResult
} from '@engine/types'
import type { RulesState } from '../../main/rules-store'
import type { OpenedFile } from '../../preload'
import SheetPreview from './SheetPreview'
import { TutorialBanner } from './Tutorial'

interface Props {
  active: boolean
  rules: RulesState | null
  rulesRev: number
  onRulesChanged: (s: RulesState) => void
  /** 주소 매기기 화면에서 넘어온 파일 */
  incoming: OpenedFile | null
  tutorial: boolean
  onExitTutorial: () => void
}

const RESOLUTIONS: Resolution[] = [...CATEGORIES, EXCLUDE]

function optionsFromProfile(p: Profile | undefined): TransformOptions {
  if (!p) return DEFAULT_OPTIONS
  return {
    addressSource: p.address_source ?? 'auto',
    groupKeys: p.group_keys?.length ? p.group_keys : DEFAULT_OPTIONS.groupKeys,
    createEmptySheets: p.create_empty_sheets ?? true,
    singleControlSheetNaming: p.single_control_sheet_naming ?? 'simple',
    rowOrder: p.row_order ?? DEFAULT_OPTIONS.rowOrder,
    includeSourceSheet: p.include_source_sheet ?? false
  }
}

export default function ConvertView({ active, rules, rulesRev, onRulesChanged, incoming, tutorial, onExitTutorial }: Props) {
  const [file, setFile] = useState<OpenedFile | null>(null)
  const [result, setResult] = useState<TransformResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [saveToMaster, setSaveToMaster] = useState<Record<string, boolean>>({})
  const [profileName, setProfileName] = useState('')
  const [options, setOptions] = useState<TransformOptions>(DEFAULT_OPTIONS)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string; path?: string }>({ kind: '', text: '' })

  const profiles = rules?.effective.profiles ?? []

  useEffect(() => {
    if (!profileName && profiles[0]) {
      setProfileName(profiles[0].profile_name)
      setOptions(optionsFromProfile(profiles[0]))
    }
  }, [profiles, profileName])

  // 파일·해결값·옵션·Rule이 바뀌면 다시 계산
  useEffect(() => {
    if (!file) return
    let cancelled = false
    window.api
      .run(resolutions, options)
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setStatus({ kind: 'err', text: String(e.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [file, resolutions, options, rulesRev])

  useEffect(() => {
    window.api.onOpened((f) => load(Promise.resolve(f)))
  }, [])

  useEffect(() => {
    if (incoming) load(Promise.resolve(incoming), false)
  }, [incoming])

  // 이 화면이 열려 있으면 창 어디에 떨어뜨려도 파일을 받는다
  useEffect(() => {
    if (!active) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) load(window.api.openDroppedFile(f))
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [active])

  /** fromUser: 사용자가 직접 연 파일이면 튜토리얼을 끝낸다 (튜토리얼 중에는 Rule 저장이 막혀 있으므로) */
  function load(p: Promise<OpenedFile | null>, fromUser = true) {
    p.then((f) => {
      if (!f) return
      if (fromUser) onExitTutorial()
      setFile(f)
      setResult(null)
      setResolutions({})
      setSaveToMaster({})
      setStatus({ kind: '', text: '' })
    }).catch((e) => setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${e.message ?? e}` }))
  }

  const a = result?.analysis
  const pendingPrefixes = useMemo(() => a?.prefixMappings.filter((m) => m.status !== 'rule') ?? [], [a])
  const unresolved = pendingPrefixes.filter((m) => m.status === 'unknown')

  async function generate() {
    if (!a || a.blocked) return
    setBusy(true)
    setStatus({ kind: '', text: 'Excel 만드는 중…' })
    try {
      const path = await window.api.saveExcel(resolutions, options)
      if (!path) {
        setStatus({ kind: '', text: '저장을 취소했습니다.' })
        return
      }
      // 체크된 신규 Prefix를 내 PC Rule에 저장
      // 튜토리얼 중에는 Rule을 저장하지 않는다
      const toSave = tutorial ? [] : pendingPrefixes.filter((m) => m.status === 'resolved' && (saveToMaster[m.prefix] ?? true))
      if (toSave.length && rules) {
        const now = new Date().toISOString()
        const added: PositionRule[] = toSave.map((m) => ({
          pattern: `${m.prefix}-*`,
          category: m.category!,
          output_prefix: m.outputPrefix ?? '',
          active: true,
          source: 'user',
          created_at: now
        }))
        const keep = rules.local.positionRules.filter((r) => !added.some((n) => n.pattern === r.pattern))
        onRulesChanged(await window.api.saveLocalRules({ ...rules.local, positionRules: [...keep, ...added] }))
      }
      setStatus({
        kind: 'ok',
        text: `저장 완료${toSave.length ? ` · 새 Rule ${toSave.length}개를 내 PC에 저장했습니다` : ''}`,
        path
      })
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
        onClick={() => load(window.api.pickCsv())}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
      >
        <div className="icon">📄</div>
        <h2>디자인 CSV 파일을 여기로 끌어다 놓으세요</h2>
        <p>또는 클릭해서 파일 선택 · 타상/연발/단발 분류와 Cue 병합을 자동으로 처리합니다</p>
        {status.kind === 'err' && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{status.text}</p>}
      </div>
    )
  }

  const issueCounts = { blocking: 0, warning: 0, info: 0 }
  a?.issues.forEach((i) => (issueCounts[i.severity] += 1))
  const singleControl = (a?.controls.length ?? 0) <= 1

  const tutorialBanner = !tutorial ? null : unresolved.length > 0 ? (
    <TutorialBanner step="2/3" onExit={onExitTutorial}>
      처음 보는 Prefix <span className="mono">{unresolved.map((m) => m.prefix + '-*').join(', ')}</span>가 있어서 Excel 생성이 막혀 있어요. 왼쪽{' '}
      <b>빨간 상자</b>에서 분류를 고르세요. (샘플의 7P는 7인치 타상이에요)
    </TutorialBanner>
  ) : status.kind === 'ok' ? (
    <TutorialBanner step="완료" onExit={onExitTutorial}>
      🎉 끝! 아래 <b>폴더 열기</b>로 만든 Excel을 확인해 보세요. 이제 실제 CSV로 똑같이 하면 됩니다.
    </TutorialBanner>
  ) : (
    <TutorialBanner step="3/3" onExit={onExitTutorial}>
      오른쪽 미리보기에서 <b>시트 탭</b>을 눌러 결과를 확인하고(같은 시간·같은 효과는 한 줄로 합쳐져요), 아래 <b>Excel 생성</b>을 누르세요.
    </TutorialBanner>
  )

  return (
    <>
      {tutorialBanner}
      <div className="work">
        <div className="side">
          <div className="card file-card">
            <div style={{ flex: 1 }}>
              <div className="name">{file.fileName}</div>
              <div className="meta">
                {file.rows.toLocaleString()}행 · {file.encoding}
              </div>
            </div>
            <button className="btn small" onClick={() => load(window.api.pickCsv())}>
              다른 파일
            </button>
          </div>

          {a && (
            <div className="card">
              <h3>파일 분석</h3>
              <dl className="stats">
                <dt>Control</dt>
                <dd className="chips">
                  {a.controls.map((c) => (
                    <span className="chip" key={c.name}>
                      {c.name} <span className="hint">{c.rowCount}</span>
                    </span>
                  ))}
                </dd>
                <dt>주소 방식</dt>
                <dd>
                  <b>{a.addressSummary.dominant}</b>{' '}
                  <span className="hint">
                    (ADDR {a.addressSummary.addr} · MODULE-PIN {a.addressSummary.modulePin} · 없음 {a.addressSummary.none})
                  </span>
                </dd>
                <dt>감지된 컬럼</dt>
                <dd className="chips">
                  {a.detectedColumns.map((c) => (
                    <span className="chip" key={c.key}>
                      {c.header}
                    </span>
                  ))}
                </dd>
                {a.ignoredColumns.length > 0 && (
                  <>
                    <dt>결과 미포함</dt>
                    <dd className="chips">
                      {a.ignoredColumns.map((c) => (
                        <span className="chip dim" key={c}>
                          {c}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {pendingPrefixes.length > 0 && (
            <div className={`card ${unresolved.length ? 'alert' : ''}`}>
              <h3>
                미등록 POS Prefix <span className="count">{pendingPrefixes.length}</span>
                <span className="spacer" />
                {unresolved.some((m) => m.suggestion) && (
                  <button
                    className="btn small"
                    onClick={() =>
                      setResolutions((r) => {
                        const next = { ...r }
                        unresolved.forEach((m) => m.suggestion && (next[m.prefix] = m.suggestion))
                        return next
                      })
                    }
                  >
                    TYPE 제안대로 선택
                  </button>
                )}
              </h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Prefix</th>
                    <th className="num">행</th>
                    <th>분류</th>
                    <th title="Excel을 만들 때 이 선택을 Rule로 저장">Rule 저장</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPrefixes.map((m) => (
                    <tr key={m.prefix}>
                      <td>
                        <span className="mono">{m.prefix}-*</span>
                        <div className="hint">
                          예: {m.examples.join(', ')}
                          {m.suggestion && ` · TYPE 제안: ${m.suggestion}`}
                        </div>
                      </td>
                      <td className="num">{m.rowCount}</td>
                      <td>
                        <select
                          value={resolutions[m.prefix] ?? ''}
                          onChange={(e) =>
                            setResolutions((r) => {
                              const next = { ...r }
                              if (e.target.value) next[m.prefix] = e.target.value as Resolution
                              else delete next[m.prefix]
                              return next
                            })
                          }
                        >
                          <option value="">선택하세요</option>
                          {RESOLUTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!tutorial && (saveToMaster[m.prefix] ?? true)}
                          disabled={tutorial}
                          title={tutorial ? '튜토리얼 중에는 Rule을 저장하지 않습니다' : undefined}
                          onChange={(e) => setSaveToMaster((s) => ({ ...s, [m.prefix]: e.target.checked }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {a && (
            <div className="card">
              <h3>Rule 적용 미리보기</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>원본</th>
                    <th>분류</th>
                    <th>변환</th>
                    <th className="num">행</th>
                  </tr>
                </thead>
                <tbody>
                  {a.prefixMappings.map((m) => (
                    <tr key={m.prefix}>
                      <td className="mono">
                        {m.examples[0] ?? `${m.prefix}-*`}
                        {m.ruleSource === 'user' && <span className="src user"> 내 Rule</span>}
                      </td>
                      <td>{m.category ? <span className={`cat ${m.category}`}>{m.category}</span> : <span className="hint">미정</span>}</td>
                      <td className="mono">{m.outputPrefix ? `${m.outputPrefix}-${m.examples[0]?.split('-').pop() ?? '*'}` : '—'}</td>
                      <td className="num">{m.rowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 style={{ marginTop: 14 }}>카테고리별 원본 행 → 병합 후 Cue</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Control</th>
                    {CATEGORIES.map((c) => (
                      <th key={c} className="num">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.controls.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      {CATEGORIES.map((cat) => {
                        const s = a.categoryStats.find((x) => x.control === c.name && x.category === cat)
                        return (
                          <td key={cat} className="num">
                            {s && s.rows ? (
                              <>
                                {s.rows} → <b>{s.groups}</b>
                              </>
                            ) : (
                              <span className="hint">0</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {a && (
            <div className="card">
              <h3>
                검증 결과
                {issueCounts.blocking > 0 && <span className="count" style={{ color: 'var(--danger)' }}>필수 {issueCounts.blocking}</span>}
                {issueCounts.warning > 0 && <span className="count" style={{ color: 'var(--warn)' }}>경고 {issueCounts.warning}</span>}
              </h3>
              {a.issues.length === 0 ? (
                <div className="ok-line">문제 없음 ✓</div>
              ) : (
                a.issues.map((i) => <IssueItem key={i.code + i.message} issue={i} />)
              )}
            </div>
          )}

          <div className="card">
            <h3>옵션</h3>
            <label className="opt">
              프로필
              <select
                value={profileName}
                onChange={(e) => {
                  setProfileName(e.target.value)
                  setOptions(optionsFromProfile(profiles.find((p) => p.profile_name === e.target.value)))
                }}
              >
                {profiles.map((p) => (
                  <option key={p.profile_name}>{p.profile_name}</option>
                ))}
              </select>
            </label>
            <label className="opt">
              주소 사용
              <select
                value={options.addressSource}
                onChange={(e) => setOptions({ ...options, addressSource: e.target.value as TransformOptions['addressSource'] })}
              >
                <option value="auto">자동 (ADDR 우선, 없으면 MODULE-PIN)</option>
                <option value="addr">ADDR만</option>
                <option value="module_pin">MODULE-PIN만</option>
              </select>
            </label>
            <label className="opt">
              행 순서
              <select value={options.rowOrder} onChange={(e) => setOptions({ ...options, rowOrder: e.target.value as TransformOptions['rowOrder'] })}>
                <option value="effect">제품명순 (같은 효과끼리 → 시간순)</option>
                <option value="time">시간순</option>
              </select>
            </label>
            <label className="opt">
              원본 데이터 시트 포함 (맨 앞)
              <input
                type="checkbox"
                checked={options.includeSourceSheet}
                onChange={(e) => setOptions({ ...options, includeSourceSheet: e.target.checked })}
              />
            </label>
            <label className="opt">
              데이터 없는 시트도 만들기
              <input
                type="checkbox"
                checked={options.createEmptySheets}
                onChange={(e) => setOptions({ ...options, createEmptySheets: e.target.checked })}
              />
            </label>
            {singleControl && (
              <label className="opt">
                시트 이름
                <select
                  value={options.singleControlSheetNaming}
                  onChange={(e) =>
                    setOptions({ ...options, singleControlSheetNaming: e.target.value as TransformOptions['singleControlSheetNaming'] })
                  }
                >
                  <option value="simple">타상 / 연발 / 단발</option>
                  <option value="full">Control명 포함</option>
                </select>
              </label>
            )}
            <div className="hint">병합 기준: HH + MM + SS + FF + Effect Description</div>
          </div>
        </div>

        <div className="main">{result && <SheetPreview sheets={result.sheets} />}</div>
      </div>

      <div className="actionbar">
        <div className={`status ${status.kind}`}>
          {status.text ||
            (a?.blocked
              ? unresolved.length
                ? `미등록 Prefix ${unresolved.length}개의 분류를 선택해야 Excel을 만들 수 있습니다.`
                : '필수 항목을 해결해야 Excel을 만들 수 있습니다.'
              : a
                ? `${result!.sheets.length}개 시트가 만들어집니다.`
                : '분석 중…')}
          {status.path && (
            <button className="btn link" style={{ marginLeft: 10 }} onClick={() => window.api.showItem(status.path!)}>
              폴더 열기
            </button>
          )}
        </div>
        <button className="btn primary big" disabled={!a || a.blocked || busy} onClick={generate}>
          Excel 생성
        </button>
      </div>
    </>
  )
}

function IssueItem({ issue }: { issue: Issue }) {
  const hasMore = (issue.details?.length ?? 0) > 0 || (issue.lines?.length ?? 0) > 0
  const label = (
    <>
      {issue.message}
      {issue.count && issue.count > 1 ? <b> ({issue.count}건)</b> : null}
    </>
  )
  if (!hasMore) return <div className={`issue ${issue.severity}`}>{label}</div>
  return (
    <details className={`issue ${issue.severity}`}>
      <summary>{label}</summary>
      <div className="detail">
        {issue.details?.map((d, i) => <div key={i}>{d}</div>)}
        {!issue.details && issue.lines && (
          <div>
            CSV 줄: {issue.lines.join(', ')}
            {(issue.count ?? 0) > issue.lines.length && ' …'}
          </div>
        )}
      </div>
    </details>
  )
}
