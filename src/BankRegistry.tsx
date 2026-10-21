import Alert from './components/Alert'
import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { BankRecord } from '../electron/api-contract'
import { bankRepository } from './services/bankRepository'
import BankFormModal from './components/BankFormModal'
import DictionaryTable, { DictionarySearch, DictionaryToolbar } from './components/DictionaryTable'
import ConfirmDialog from './components/ConfirmDialog'

export default function BankRegistry() {
  const [banks, setBanks] = useState<BankRecord[]>([])
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<BankRecord | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BankRecord | null>(null)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError('')
    void bankRepository.list(query).then(rows => { if (active) { setBanks(rows); setError('') } }, () => { if (active) setLoadError('Не вдалося завантажити довідник банків.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, revision])
  const open = async (id: string, remove = false) => {
    try {
      const bank = await bankRepository.get(id)
      if (!bank) { setError('Банк не знайдено. Оновіть довідник.'); return }
      if (remove) {
        if (bank.recipientCount) { setError(`Банк використовується у ${bank.recipientCount} картках отримувачів. Видалення заборонено.`); return }
        setDeleteError(''); setDeleting(bank)
      } else setEditing(bank)
    } catch { setError('Не вдалося відкрити банк. Повторіть спробу.') }
  }
  return <section className="dashboard-panel registry-panel bank-registry dictionary-registry">
    <DictionaryToolbar unavailable={Boolean(loadError)} title="Банки" count={`Банків: ${banks.length}`} loading={loading}>
      <DictionarySearch value={query} onChange={setQuery} label="Пошук банків за назвою, МФО або ЄДРПОУ" placeholder="Назва банку, МФО або ЄДРПОУ"/>
      <button className="primary-button" onClick={() => setEditing('new')}><Plus size={17}/>Додати банк</button>
    </DictionaryToolbar>
    {error && <Alert variant="error" action={<button onClick={() => setRevision(current => current + 1)}>Оновити</button>}>{error}</Alert>}
    <DictionaryTable error={loadError} onRetry={() => setRevision(current => current + 1)} label="Банки" className="dictionary-banks" loading={loading} filtered={Boolean(query.trim())} empty={!banks.length ? query.trim() ? 'За цим запитом банків не знайдено.' : 'Банків поки немає. Додайте перший банк.' : undefined} columns={[{label:'№',width:'48px'},{label:'Найменування банку'},{label:'Наборів реквізитів',width:'160px',className:'dictionary-center'},{label:'Дії',width:'94px',className:'dictionary-actions-cell'}]}>
      {banks.map((bank, index) => <tr key={bank.id}><td className="dictionary-number">{index + 1}</td><td><strong className="registry-name">{bank.name}</strong></td><td className="dictionary-center dictionary-number">{bank.details.length}</td><td className="dictionary-actions-cell"><div className="registry-row-actions"><button className="table-action" title="Редагувати банк" aria-label={`Редагувати банк: ${bank.name}`} onClick={() => void open(bank.id)}><Pencil size={17}/></button><button className="table-action danger-action" title="Видалити банк" aria-label={`Видалити банк: ${bank.name}`} onClick={() => void open(bank.id, true)}><Trash2 size={17}/></button></div></td></tr>)}
    </DictionaryTable>
    {editing && <BankFormModal initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(current => current + 1) }}/>}
    {deleting && <ConfirmDialog title="Видалити банк?" message={`«${deleting.name}». Буде безповоротно видалено банк та ${deleting.details.length} наборів реквізитів. Картки отримувачів не видалятимуться.`} confirmLabel="Видалити" confirmIcon={<Trash2 size={17}/>} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={async () => {
      try {
        const result = await bankRepository.remove(deleting.id, deleting.updatedAt)
        if (!result.ok) { setDeleteError(result.message ?? 'Не вдалося видалити банк.'); return }
        setDeleting(null); setRevision(current => current + 1)
      } catch { setDeleteError('Не вдалося видалити банк. Повторіть спробу.') }
    }}/>}
  </section>
}
