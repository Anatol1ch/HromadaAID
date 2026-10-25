import { useEffect, useRef, useState } from 'react'
import { FileText, FileSpreadsheet, LoaderCircle, Printer } from 'lucide-react'
import type { PreparedReport } from '../../electron/api-contract'
import Modal from './Modal'
import Alert from './Alert'
import { notifySystemToast } from './SystemToastHost'

export default function ReportPreviewModal({ document, onClose }: { document: PreparedReport; onClose: () => void }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const inFlight = useRef(false)
  const [url, setUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [operation, setOperation] = useState<'pdf' | 'excel' | 'print' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const binary = atob(document.pdfBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    const next = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    setLoaded(false); setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [document.pdfBase64])
  const execute = async (action: 'pdf' | 'excel' | 'print') => {
    if (inFlight.current || action === 'print' && !loaded) return
    inFlight.current = true; setOperation(action); setError('')
    try {
      if (action === 'print') {
        if (!iframe.current?.contentWindow) throw new Error('PDF недоступний.')
        // Same built-in PDF viewer printing path as the statement preview.
        iframe.current.contentWindow.print()
      } else {
        const result = action === 'pdf' ? await window.hromadaAid.reports.savePdf(document.id) : await window.hromadaAid.reports.saveExcel(document.id)
        if (result.ok) notifySystemToast('success', 'Звіт збережено', action === 'pdf' ? 'PDF-файл збережено.' : 'Excel-файл збережено.')
        else if (!result.canceled) setError(result.message ?? 'Не вдалося зберегти документ. Повторіть спробу.')
      }
    } catch { setError(action === 'print' ? 'Не вдалося відкрити друк PDF. Повторіть спробу.' : 'Не вдалося зберегти документ. Перегляд PDF залишається доступним.') }
    finally { inFlight.current = false; setOperation(null) }
  }
  const busy = operation !== null
  return <Modal title={document.title} description={document.periodRange} size="large" className="report-preview-modal document-preview-modal" headerIcon={<FileText size={21} aria-hidden="true"/>} busy={busy} onClose={() => { if (!inFlight.current) onClose() }}>
    <div className="statement-preview-toolbar">
      <div className="document-preview-actions" aria-label="Дії зі сформованим звітом" aria-busy={busy}>
        <button type="button" className="secondary-button document-preview-action" disabled={busy || !loaded} onClick={() => void execute('print')}><Printer size={17} aria-hidden="true"/>{operation === 'print' ? 'Відкриваємо друк…' : 'Друк'}</button>
        <button type="button" className="secondary-button document-preview-action" disabled={busy} onClick={() => void execute('excel')}>{operation === 'excel' ? <LoaderCircle className="formation-spinner" size={17} aria-hidden="true"/> : <FileSpreadsheet size={17} aria-hidden="true"/>}{operation === 'excel' ? 'Формуємо Excel…' : 'Зберегти Excel'}</button>
        <button type="button" className="secondary-button document-preview-action" disabled={busy} onClick={() => void execute('pdf')}>{operation === 'pdf' ? <LoaderCircle className="formation-spinner" size={17} aria-hidden="true"/> : <FileText size={17} aria-hidden="true"/>}{operation === 'pdf' ? 'Зберігаємо…' : 'Зберегти PDF'}</button>
      </div>
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    {url && <iframe ref={iframe} className="statement-pdf-preview" title={`Попередній перегляд: ${document.title}, ${document.periodRange}`} src={`${url}#toolbar=1&navpanes=0&zoom=page-width`} onLoad={() => setLoaded(true)}/>}
  </Modal>
}
