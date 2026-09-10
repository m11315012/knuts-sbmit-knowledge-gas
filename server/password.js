import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{64}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const actual = await derive(password, salt, 64, options);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
