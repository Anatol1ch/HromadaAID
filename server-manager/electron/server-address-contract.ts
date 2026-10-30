export type ServerAddressKey = 'loopback' | 'lan' | 'tailscale'
export type ServerAddresses = { version: 1; loopback: string; lan: string | null; tailscale: string | null }
export type AddressResult = { ok: true; addresses: ServerAddresses } | { ok: false; message: string; storageError: boolean }
export type AddressCopyResult = { ok: true } | { ok: false; message: string }
