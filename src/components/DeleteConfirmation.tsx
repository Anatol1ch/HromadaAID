import { notifyOverviewChanged } from '../services/overviewUpdates'
import { notifyCatalogsChanged } from '../services/catalogRepository'
import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DeleteEntity, DeletePreview } from '../../electron/api-contract'
import ConfirmDialog from './ConfirmDialog'

const titles: Record<DeleteEntity, string> = {
  assignment: 'Видалити призначення?', recipient: 'Видалити отримувача?', decision: 'Видалити рішення?',
  program: 'Видалити програму?', aidType: 'Видалити вид допомоги?',
}

export default function DeleteConfirmation({ preview, onClose, onDeleted }: {
  preview: DeletePreview
  onClose: () => void
  onDeleted: () => Promise<void> | void
}) {
  const [error, setError] = useState('')
  const [deleted, setDeleted] = useState(false)
  const committed = useRef(false)
  const remove = async () => {
    if (committed.current) return
    setError('')
    try {
      const result = await window.hromadaAid.deletion.execute(preview.entity, preview.id, preview.confirmationToken)
      if (!result.ok) { setError(result.message ?? 'Не вдалося видалити запис.'); return }
      committed.current = true; setDeleted(true)
      if (preview.entity === 'program' || preview.entity === 'aidType') notifyCatalogsChanged()
      else notifyOverviewChanged()
    } catch { setError('Не вдалося видалити запис. Перевірте список перед повторною спробою.'); return }
    try { await onDeleted() }
    catch { setError('Запис видалено, але не вдалося оновити список. Закрийте це вікно та оновіть список.'); }
  }
  return <ConfirmDialog title={titles[preview.entity]} description="Ця дія є безповоротною." variant="danger"
    message={<><strong>{preview.name}</strong><p>Запис буде остаточно видалено. Відновити його буде неможливо.</p></>}
    confirmLabel="Видалити" busyLabel="Видаляємо…" confirmIcon={<Trash2 size={17} aria-hidden="true"/>}
    confirmDisabled={deleted} error={error} onCancel={onClose} onConfirm={remove}>
    {preview.dependencies.length > 0 ? <div className="delete-dependencies"><strong>Разом буде остаточно видалено:</strong><ul>{preview.dependencies.map((item) => <li key={item.label}>{item.label}: <b>{item.count}</b></li>)}</ul></div> : <p className="confirm-dialog-detail">Пов’язаних записів немає.</p>}
  </ConfirmDialog>
}
