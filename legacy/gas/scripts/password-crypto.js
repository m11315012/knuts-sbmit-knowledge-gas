import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export function derive(passwordBytes, saltBytes) {
  return bytesToHex(pbkdf2(sha256, passwordBytes, saltBytes, { c: 600000, dkLen: 32 }));
}
