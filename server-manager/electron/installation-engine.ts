import type { ServerInstallRequest, ServerInstallStage, ServerInstallUpdate } from './installation-contract.js'
import { installationVerificationIssues, type InstallationInspection } from './installation-contract.js'

export type ServerInstallAdapters = {
  inspect(): Promise<InstallationInspection>
  wait?(milliseconds: number): Promise<void>
  canResume?(request: ServerInstallRequest): Promise<boolean>
  preflight(request: ServerInstallRequest): Promise<void>
  stagePackage(request: ServerInstallRequest): Promise<void>
  prepareConfiguration(request: ServerInstallRequest): Promise<void>
  recordLocator(request: ServerInstallRequest): Promise<void>
  initialize(request: ServerInstallRequest, confirmKey: (key: string) => Promise<boolean>, stage: (message: string) => void): Promise<void>
  databaseStatus(request: ServerInstallRequest): Promise<{ users: 0 | 'present' }>
  hasPendingAdminMarker(request: ServerInstallRequest): Promise<boolean>
  createAdministrator(request: ServerInstallRequest): Promise<void>
  installService(request: ServerInstallRequest, stage: (message: string) => void): Promise<void>
}

function progress(operationId: string, stage: ServerInstallStage, message: string, emit: (event: ServerInstallUpdate) => void): void {
  emit({ operationId, stage, status: 'running', message })
}

/** Focused first-install coordinator; all operating-system work is injected by the Electron main adapter. */
export async function runServerInstallation(
  request: ServerInstallRequest,
  adapters: ServerInstallAdapters,
  operationId: string,
  emit: (event: ServerInstallUpdate) => void,
  confirmRecoveryKey: (key: string) => Promise<boolean>,
): Promise<void> {
  let stage: ServerInstallStage = 'validation'
  try {
    progress(operationId, stage, 'Перевіряємо стан цього комп’ютера та параметри встановлення.', emit)
    const current = await adapters.inspect()
    const resuming = current.installation.status === 'partial_installation' && adapters.canResume ? await adapters.canResume(request) : false
    if (current.installation.status !== 'not_installed' && !resuming) {
      throw Object.assign(new Error('Знайдено наявну або неповну інсталяцію. Перевірте її стан у розділі «Огляд»; чисте встановлення не розпочато.'), { code: 'INSTALLATION_ALREADY_PRESENT' })
    }
    if (!request || !request.programDirectory || !request.dataDirectory || !request.backupDirectory) {
      throw Object.assign(new Error('Перевірте каталоги сервера.'), { code: 'INSTALL_OPTIONS_INVALID' })
    }

    stage = 'preflight'
    progress(operationId, stage, 'Перевіряємо диски, файлову систему, вільне місце та наявні дані.', emit)
    await adapters.preflight(request)
    await adapters.recordLocator(request)
    stage = 'directories'
    progress(operationId, stage, 'Готуємо серверний пакет у вибраному каталозі.', emit)
    await adapters.stagePackage(request)
    stage = 'configuration'
    progress(operationId, stage, 'Створюємо конфігурацію та потрібні каталоги.', emit)
    await adapters.prepareConfiguration(request)
    stage = 'database'
    progress(operationId, stage, 'Перевіряємо серверні дані й за потреби ініціалізуємо базу.', emit)
    await adapters.initialize(request, async key => {
      emit({ operationId, stage: 'recovery-key', status: 'awaiting-confirmation', message: 'Збережіть аварійний ключ у безпечному місці та підтвердьте це.' })
      return confirmRecoveryKey(key)
    }, message => emit({ operationId, stage: 'recovery-key', status: 'running', message }))

    stage = 'administrator'
    const status = await adapters.databaseStatus(request)
    if (status.users === 0) {
      if (!(await adapters.hasPendingAdminMarker(request))) {
        throw Object.assign(new Error('База не містить користувачів, але немає підтвердженого маркера першого встановлення. Створення адміністратора зупинено.'), { code: 'FIRST_ADMIN_NOT_AUTHORIZED' })
      }
      progress(operationId, stage, 'Створюємо першого адміністратора за серверними правилами.', emit)
      await adapters.createAdministrator(request)
      const verified = await adapters.databaseStatus(request)
      if (verified.users !== 'present') throw Object.assign(new Error('Не вдалося підтвердити створення адміністратора.'), { code: 'FIRST_ADMIN_VERIFY_FAILED' })
    } else {
      progress(operationId, stage, 'Наявний обліковий запис збережено; нового адміністратора не створювали.', emit)
    }

    stage = 'service'
    progress(operationId, stage, 'Реєструємо Windows Service та запускаємо сервер.', emit)
    await adapters.installService(request, message => emit({ operationId, stage, status: 'running', message }))
    stage = 'health'
    progress(operationId, stage, 'Перевіряємо стан служби та API.', emit)
    let finalState: InstallationInspection | undefined
    let issues: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        progress(operationId, stage, `Серверний сценарій завершено. Повторюємо лише перевірку стану (${attempt + 1}/3).`, emit)
        await (adapters.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(attempt * 1_000)
      }
      try { finalState = await adapters.inspect(); issues = installationVerificationIssues(finalState) }
      catch { finalState = undefined; issues = ['Додаткова діагностика середовища тимчасово недоступна.'] }
      if (issues.length === 0) break
    }
    if (issues.length || !finalState?.configuration?.serverVersion || !finalState.configuration.apiAddress) {
      emit({ operationId, stage, status: 'verification-required', errorCode: 'INSTALLATION_VERIFY_PENDING', message: `Серверний сценарій встановлення завершено. Додаткове підтвердження не отримано: ${issues.join(' ')} Повторіть перевірку стану. Повторно встановлювати або ініціалізувати сервер не потрібно.` })
      return
    }
    stage = 'complete'
    emit({ operationId, stage, status: 'succeeded', message: 'Сервер встановлено; Windows Service працює, API доступний.', result: { service: 'running', api: 'available', serverVersion: finalState.configuration.serverVersion, apiAddress: finalState.configuration.apiAddress } })
  } catch (error) {
    const failure = error as Error & { code?: string }
    emit({ operationId, stage, status: 'failed', message: failure.message || 'Встановлення не завершено. Наявні дані збережено.', errorCode: failure.code ?? 'INSTALLATION_FAILED' })
    throw error
  } finally {
    request.administrator.password = ''
    request.administrator.confirmation = ''
  }
}
