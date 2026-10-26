import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import KeyboardNavigation from './components/KeyboardNavigation'
import SystemToastHost from './components/SystemToastHost'
import ClientUpdateGate from './components/ClientUpdateGate'
import './styles.css'

class StartupBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="app-start-error" role="alert"><div><strong>Не вдалося підготувати робочий простір.</strong><span>Перезапустіть HromadaAid. Якщо проблема повторюється, зверніться до адміністратора системи.</span></div></main>
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><StartupBoundary><KeyboardNavigation><App /><ClientUpdateGate /><SystemToastHost /></KeyboardNavigation></StartupBoundary></React.StrictMode>,
)
