import { useCallback, useEffect, useState } from 'react'
import type { RulesState } from '../../main/rules-store'
import type { UpdateStatus } from '../../main/updates'
import type { AssignSource, OpenedFile } from '../../preload'
import { TutorialModal, tutorialSeen } from './Tutorial'
import AssignView from './AssignView'
import ConvertView from './ConvertView'
import RulesView from './RulesView'

type Tab = 'assign' | 'convert' | 'rules'

export default function App() {
  const [tab, setTab] = useState<Tab>((['assign', 'rules'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'convert') as Tab)
  const [rules, setRules] = useState<RulesState | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  /** Rule이 바뀔 때마다 증가시켜 변환 화면이 다시 계산하도록 한다 */
  const [rulesRev, setRulesRev] = useState(0)
  const [handoff, setHandoff] = useState<OpenedFile | null>(null)
  const [showIntro, setShowIntro] = useState(() => !tutorialSeen() && !location.hash)
  const [tutorial, setTutorial] = useState(false)
  const [sampleSource, setSampleSource] = useState<AssignSource | null>(null)

  async function startSample() {
    setShowIntro(false)
    setTutorial(true)
    setTab('assign')
    setSampleSource(await window.api.tutorialSample())
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
        <nav className="tabs">
          <button className={`tab ${tab === 'assign' ? 'active' : ''}`} onClick={() => setTab('assign')}>
            ① 주소 매기기
          </button>
          <button className={`tab ${tab === 'convert' ? 'active' : ''}`} onClick={() => setTab('convert')}>
            ② 시트 정리
          </button>
          <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
            Rule 관리
          </button>
        </nav>
        <div className="spacer" />
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
        <div style={{ display: tab === 'assign' ? 'contents' : 'none' }}>
          <AssignView
            active={tab === 'assign'}
            tutorial={tutorial}
            onExitTutorial={() => setTutorial(false)}
            incoming={sampleSource}
            onSendToConvert={(f) => {
              setHandoff(f)
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
          />
        </div>
        {tab === 'rules' && rules && <RulesView rules={rules} onRulesChanged={onRulesChanged} />}
      </main>
      {showIntro && <TutorialModal onClose={() => setShowIntro(false)} onStartSample={startSample} />}
    </div>
  )
}
