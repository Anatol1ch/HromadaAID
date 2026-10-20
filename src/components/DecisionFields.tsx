import type { DecisionInput } from '../../electron/api-contract'
import DateField from './DateField'
import ValidatedInput from './ValidatedInput'

export default function DecisionFields({ value, onChange, year, disabled = false }: { value: DecisionInput; onChange: (value: DecisionInput) => void; year?: number; disabled?: boolean }) {
  return <div className="decision-form-grid">
    <label className="recipient-field"><span>Номер рішення *</span><ValidatedInput disabled={disabled} autoFocus required maxLength={100} value={value.decisionNumber} onChange={(event) => onChange({ ...value, decisionNumber: event.target.value })} placeholder="Наприклад, 184"/></label>
    <label className="recipient-field"><span>Дата рішення *</span><DateField disabled={disabled} required value={value.decisionDate} min={year ? `${year}-01-01` : undefined} max={year ? `${year}-12-31` : undefined} onChange={(decisionDate) => onChange({ ...value, decisionDate })}/></label>
    <label className="recipient-field decision-title-field"><span>Примітка (за потреби)</span><ValidatedInput disabled={disabled} maxLength={300} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })}/></label>
  </div>
}
