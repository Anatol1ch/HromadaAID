export type AddressParts = {
  postalCode: string
  region: string
  district: string
  settlementType: 'місто' | 'селище' | 'село' | ''
  settlementName: string
  streetType: 'вулиця' | 'провулок' | 'проспект' | 'площа' | 'бульвар' | 'проїзд' | 'узвіз' | 'набережна' | 'шосе' | 'інше' | ''
  customStreetType: string
  streetName: string
  building: string
  apartment: string
}
