import { formatAddress } from '../../electron/address.ts'

export const testAddress = (patch = {}) => ({ postalCode: '00001', region: 'Тестова', district: 'Вигаданий', settlementType: 'село', settlementName: 'Тестове', streetType: 'вулиця', customStreetType: '', streetName: 'Прикладна', building: '1', apartment: '', ...patch })
export const testAddressInput = () => {
  const registeredAddressParts = testAddress()
  const addressParts = testAddress({ streetName: 'Інша', building: '2' })
  return { registeredAddressParts, addressParts, registeredAddress: formatAddress(registeredAddressParts), address: formatAddress(addressParts) }
}
