import assert from 'node:assert/strict'
import test from 'node:test'
import { formatConnectionDiagnostics } from '../shared/connection-diagnostics.js'

test('formats only the explicit diagnostic fields and redacts credentials and personal contact details', () => {
  const text = formatConnectionDiagnostics({
    clientVersion: '1.1.1', apiUrl: 'https://admin:password@host.local', apiAvailability: 'unavailable',
    compatibility: 'unknown', clientContractVersion: 2, addressEditable: false,
    addressLockReason: 'Закріплено через token=abc123; зверніться до admin@example.com, телефон +380 67 123 45 67',
    lastError: 'Authorization: Bearer secret-value', checkedAt: '25.11.2026, 10:30:00',
  })
  assert.match(text, /Версія Client: 1\.1\.1/)
  assert.match(text, /Контракт, потрібний Client: v2/)
  assert.doesNotMatch(text, /admin:password|abc123|admin@example\.com|secret-value|067 123 45 67/)
  assert.doesNotMatch(text, /stack|SQLite|recipient/i)
})

test('omits unavailable optional values rather than inventing metadata', () => {
  const text = formatConnectionDiagnostics({ clientVersion: '', apiUrl: null, apiAvailability: 'unknown', compatibility: 'unknown', clientContractVersion: 2, addressEditable: null })
  assert.match(text, /Адреса сервера: не налаштована/)
  assert.doesNotMatch(text, /Причина обмеження|Остання відома помилка|Остання перевірка/)
})
