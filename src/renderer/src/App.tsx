import { useCallback, useEffect, useState } from 'react'
import type { RulesState } from '../../main/rules-store'
import type { UpdateStatus } from '../../main/updates'
import type { Resolution } from '@engine/types'
import type { AssignSource, OpenedFile } from '../../preload'
import { TutorialModal, tutorialSeen } from './Tutorial'
import AssignView from './AssignView'
import ConvertView from './ConvertView'
import JigView from './JigView'
import RulesView from './RulesView'

type Tab = 'assign' | 'jig' | 'convert' | 'rules'

/** 작업 순서. 파일은 앞 단계의 “→” 버튼으로 다음 단계에 넘어가고, 각 단계는 자기 파일·설정을 그대로 들고 있다 */
const STEPS: { key: Tab; n: string; label: string }[] = [
  { key: 'jig', n: '①', label: '치구 배치' },
  { key: 'assign', n: '②', label: '주소 매기기' },
  { key: 'convert', n: '③', label: '시트 정리' }
]

export default function App() {
  // 처음에는 항상 ①부터 (원본 CSV → ① 치구 배치 → ② 주소 매기기 → ③ 시트 정리)
  const [tab, setTab] = useState<Tab>((['assign', 'convert', 'rules'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'jig') as Tab)
  /** ② 주소 매기기에 넘어온 원본 (① 치구 배치 또는 튜토리얼) */
  const [assignIncoming, setAssignIncoming] = useState<AssignSource | null>(null)
  /** ①에서 이번 작업에만 쓰기로 고른 접두어 분류 → ③까지 */
  const [sessionResolutions, setSessionResolutions] = useState<Record<string, Resolution>>({})
  /** ③에서 “이전 단계”로 돌아갈 곳 */
  const [convertFrom, setConvertFrom] = useState<'assign' | null>(null)
  const [rules, setRules] = useState<RulesState | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  /** Rule이 바뀔 때마다 증가시켜 변환 화면이 다시 계산하도록 한다 */
  const [rulesRev, setRulesRev] = useState(0)
  const [handoff, setHandoff] = useState<OpenedFile | null>(null)
  const [showIntro, setShowIntro] = useState(() => !tutorialSeen() && !location.hash)
  const [tutorial, setTutorial] = useState(false)

  async function startSample() {
    setShowIntro(false)
    setTutorial(true)
    setTab('assign')
    setAssignIncoming(await window.api.tutorialSample())
  }

  useEffect(() => {
    window.api.getRules().then(setRules)
    window.api.appInfo().then((i) => setVersion(i.version))
    window.api.onUpdate(setUpdate)
    if (location.hash === '#tutorial') startSample()
  }, [])

  const onRulesChanged = useCallback((s: RulesState) => {
    setRules(s)
    setRulesRev((r) => r + 1)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>불꽃쇼 CSV 자동 정리
        </div>
        <nav className="tabs steps-nav">
          {STEPS.map((s, i) => {
            const current = STEPS.findIndex((x) => x.key === tab)
            const done = current > i
            return (
              <span key={s.key} className="step-wrap">
                {i > 0 && <span className="step-arrow">›</span>}
                <button className={`tab step ${tab === s.key ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => setTab(s.key)}>
                  {done ? '✓' : s.n} {s.label}
                </button>
              </span>
            )
          })}
        </nav>
        <div className="spacer" />
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
          Rule 관리
        </button>
        <button className="btn small" onClick={() => setShowIntro(true)}>
          사용법
        </button>
        <span className="version">v{version}</span>
      </header>

      {update?.kind === 'downloaded' && (
        <div className="banner">
          새 버전 {update.version}이 준비됐습니다.
          <button className="btn small" onClick={() => window.api.installUpdate()}>
            지금 재시작해서 적용
          </button>
        </div>
      )}
      {update?.kind === 'available' && (
        <div className="banner">
          새 버전 {update.version}이 나왔습니다.
          <button className="btn small" onClick={() => window.api.openExternal(update.url)}>
            다운로드 페이지 열기
          </button>
        </div>
      )}

      <main className="content">
        <div style={{ display: tab === 'jig' ? 'contents' : 'none' }}>
          <JigView
            active={tab === 'jig'}
            rules={rules}
            rulesRev={rulesRev}
            onRulesChanged={onRulesChanged}
            onSendToAssign={(s, session) => {
              setSessionResolutions(session)
              setAssignIncoming(s)
              setTab('assign')
            }}
          />
        </div>
        <div style={{ display: tab === 'assign' ? 'contents' : 'none' }}>
          <AssignView
            active={tab === 'assign'}
            tutorial={tutorial}
            onExitTutorial={() => setTutorial(false)}
            incoming={assignIncoming}
            onBack={() => setTab('jig')}
            onSendToConvert={(f) => {
              setHandoff(f)
              setConvertFrom('assign')
              setTab('convert')
            }}
          />
        </div>
        <div style={{ display: tab === 'convert' ? 'contents' : 'none' }}>
          <ConvertView
            active={tab === 'convert'}
            rules={rules}
            rulesRev={rulesRev}
            onRulesChanged={onRulesChanged}
            incoming={handoff}
            tutorial={tutorial}
            onExitTutorial={() => setTutorial(false)}
            onBack={convertFrom ? () => setTab(convertFrom) : undefined}
            backLabel="← ② 주소 매기기"
            presetResolutions={sessionResolutions}
          />
        </div>
        {tab === 'rules' && rules && <RulesView rules={rules} onRulesChanged={onRulesChanged} />}
      </main>
      {showIntro && <TutorialModal onClose={() => setShowIntro(false)} onStartSample={startSample} />}
    </div>
  )
}
