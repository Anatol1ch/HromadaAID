import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'

/** A timeout is a failure, never an early release of the critical-operation lock.
 * The promise stays pending if termination cannot be proved; callers keep their
 * existing operation/close guards until process exit AND tree termination. */
export function monitorChild(child: ChildProcessWithoutNullStreams, options: { timeoutMs: number; terminateTree: () => Promise<boolean>; onTimeout?: (unconfirmed: boolean) => void }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', done = false, timedOut = false, closed = false, terminated = false
    let exitCode = 1
    const notifyTimeout = (unconfirmed: boolean) => { try { options.onTimeout?.(unconfirmed) } catch { /* UI failure must never interrupt process termination or release ownership. */ } }
    const settle = () => {
      if (done || !closed || timedOut && !terminated) return
      done = true; clearTimeout(timer)
      if (timedOut) reject(Object.assign(new Error('Час очікування вичерпано. Завершення процесу підтверджено; перевірте незавершене відновлення та стан служби.'), { code: 'RECOVERY_CHILD_TIMEOUT' }))
      else resolve({ stdout, stderr, code: exitCode })
    }
    const timer = setTimeout(() => {
      timedOut = true; notifyTimeout(false)
      void Promise.resolve().then(options.terminateTree).then(confirmed => {
        terminated = confirmed
        if (!confirmed) notifyTimeout(true)
        settle()
      }).catch(() => notifyTimeout(true))
    }, options.timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-1_000_000) })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-1_000_000) })
    child.once('error', error => {
      // Spawn failure has no process to own a lock. Errors of an already-created
      // process (e.g. kill failure) do not prove that it has exited.
      if (!child.pid && !done) { done = true; clearTimeout(timer); reject(error) }
    })
    child.once('close', code => { closed = true; exitCode = code ?? 1; settle() })
  })
}

export function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (!child.pid) return Promise.resolve(false)
  if (process.platform !== 'win32') { child.kill('SIGTERM'); return Promise.resolve(true) }
  return new Promise(resolve => {
    // Windows TerminateProcess on the root alone can orphan a synchronous DPAPI
    // PowerShell child. taskkill /T targets the fixed child PID and its descendants.
    const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.once('error', () => resolve(false))
    killer.once('close', code => resolve(code === 0))
  })
}
