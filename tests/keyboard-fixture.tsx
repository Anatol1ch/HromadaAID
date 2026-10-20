// Browser-only fixture: real UI, synthetic API, no Electron or SQLite.
import React, { useState } from 'react'
import App from '../src/App'
import { createRoot } from 'react-dom/client'
import KeyboardNavigation from '../src/components/KeyboardNavigation'
import Modal from '../src/components/Modal'
import Select from '../src/components/Select'
import DatePicker from '../src/components/DatePicker'
import YearPicker from '../src/components/YearPicker'
import BankFormModal from '../src/components/BankFormModal'
import AddressEditor from '../src/components/AddressEditor'
import DecisionFormModal from '../src/components/DecisionFormModal'
import BatchAssignmentStatusModal from '../src/components/BatchAssignmentStatusModal'
import ConfirmDialog, { UnsavedChangesConfirmation } from '../src/components/ConfirmDialog'
import { RecipientFormModal } from '../src/RecipientRegistry'
import AidRegistry from '../src/AidRegistry'
import Dictionaries from '../src/Dictionaries'
import DecisionRegistry from '../src/DecisionRegistry'
import Reports from '../src/Reports'
import { YearContext } from '../src/context/YearContext'
import '../src/styles.css'

function Fixture() {
  const [view, setView] = useState('')
  const [value, setValue] = useState('')
  const [year, setYear] = useState(2027)
  const [date, setDate] = useState('2027-01-02')
  const [nested, setNested] = useState(false)
  const [saved, setSaved] = useState(0)
  const close = () => setView('')
  const finish = () => { setSaved(n => n + 1); close() }
  return <KeyboardNavigation><YearContext.Provider value={{year, setYear}}><main className="content">
    <nav>{['app', 'controls', 'recipient', 'recipientEdit', 'bank', 'address', 'decision', 'batch', 'assignments', 'dictionaries', 'decisionRegistry', 'reports', 'danger'].map(key => <button type="button" key={key} onClick={() => setView(key)}>{key}</button>)}</nav>
    <output aria-label="Збережено">{saved}</output>
    <div className="topbar"><YearPicker value={year} onChange={setYear}/></div>
    {view === 'app' && <App/>}
    {view === 'controls' && <Modal title="Керування" onClose={close}><form onSubmit={event => {event.preventDefault(); setSaved(n => n + 1)}}>
      <input aria-label="Перше" required/><button type="button" aria-label="Швидке додавання" onClick={() => setNested(true)}>+</button>
      <input aria-label="Приховане" hidden/><input aria-label="Заблоковане" disabled/>
      <Select label="Список" required value={value} options={[{value:'a',label:'Альфа'}, {value:'b',label:'Бета'}]} onChange={setValue}/>
      <input aria-label="Наступне"/><textarea aria-label="Примітка"/>
      <DatePicker value={date} onChange={setDate}/><input type="checkbox" aria-label="Ознака"/>
      <button type="submit">Зберегти керування</button>
    </form></Modal>}
    {nested && <Modal title="Вкладене" onClose={() => setNested(false)}><form onSubmit={event => {event.preventDefault();setNested(false)}}><input aria-label="Вкладене поле"/><button type="submit">Зберегти вкладене</button></form></Modal>}
    {view === 'recipient' && <RecipientFormModal onClose={close} onSaved={finish}/>}
    {view === 'recipientEdit' && <RecipientFormModal editingId="r1" initial={{lastName:'Тестова',firstName:'Особа',patronymic:'Приклад',passport:'ТЕ123456',rnokpp:'0011223344',sex:'Жінка',isVpo:false,phone:'',email:'',bankAccount:'UA890000000000000000000000000',bankDetailsId:'detail1',registeredAddress:'',address:'',addressParts:null,registeredAddressParts:{postalCode:'52151',region:'Дніпропетровська',district:"Кам'янський",settlementType:'селище',settlementName:'Вишневе',streetType:'вулиця',customStreetType:'',streetName:'Тестова',building:'12А',apartment:''}}} onClose={close} onSaved={finish}/>}
    {view === 'bank' && <BankFormModal onClose={close} onSaved={finish}/>}
    {view === 'address' && <AddressEditor kind="registration" initial={null} onClose={close} onSave={finish}/>}
    {view === 'decision' && <DecisionFormModal year={year} onClose={close} onSaved={finish}/>}
    {view === 'batch' && <BatchAssignmentStatusModal assignmentIds={['a1','a2']} year={year} onClose={close} onSaved={finish}/>}
    {view === 'assignments' && <AidRegistry/>}
    {view === 'dictionaries' && <Dictionaries/>}
    {view === 'decisionRegistry' && <DecisionRegistry/>}
    {view === 'reports' && <Reports/>}
    {view === 'danger' && <ConfirmDialog title="Видалити тестовий запис?" message="Синтетична перевірка" confirmLabel="Видалити" onCancel={close} onConfirm={finish}/>}
    <UnsavedChangesConfirmation/>
  </main></YearContext.Provider></KeyboardNavigation>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>)
