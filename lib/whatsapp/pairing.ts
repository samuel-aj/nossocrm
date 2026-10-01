import { parsePhoneNumberFromString } from 'libphonenumber-js';

export class PairingInstanceMissingError extends Error {
  constructor() { super('A instância de conexão não foi encontrada.'); }
}

/** Pairing always needs an explicit country code; never guess or add a ninth digit. */
export function pairingPhone(input: unknown): string | null {
  if (typeof input !== 'string' || !/^\+?[\d\s()-]+$/.test(input.trim())) return null;
  const digits = input.replace(/\D/g, '');
  const phone = parsePhoneNumberFromString(`+${digits}`);
  return phone?.isValid() ? phone.number.slice(1) : null;
}

/** Evolution's `code` is QR content. Only `pairingCode` is a device linking code. */
export function pairingCode(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.replace(/-/g, '').trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(value) ? value : undefined;
}
