import SystemToast from './SystemToast'

export default function AccessDeniedToast({ onClose }: { onClose: () => void }) {
  return <SystemToast kind="access-denied" title="Доступ обмежено" message="У вашого облікового запису немає дозволу на виконання цієї дії." onClose={onClose} duration={5_000}/>
}
