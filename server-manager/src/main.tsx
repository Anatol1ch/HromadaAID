import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../../src/styles.css'
import './styles.css'

class ShellBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="sm-start-error" role="alert"><h1>Не вдалося відкрити Server Manager</h1><p>Перезапустіть оболонку. Системні операції не виконувалися.</p><button className="primary-button" onClick={() => window.location.reload()}>Перезавантажити оболонку</button></main> : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ShellBoundary><App/></ShellBoundary></StrictMode>)
