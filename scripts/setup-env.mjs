import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const secret = () => randomBytes(32).toString('hex');
const text = `# Generated locally. Do not commit or share.\nDB_PASSWORD=${secret()}\nSESSION_SECRET=${secret()}\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\nAPP_PORT=3000\nBIND_ADDRESS=127.0.0.1\nAPP_ORIGIN=http://localhost:3000\nCOOKIE_SECURE=false\nTRUST_PROXY=0\n`;
try { await writeFile('.env', text, { flag: 'wx', mode: 0o600 }); console.log('.env created. Initial administrator credentials are in this local file.'); }
catch (error) { if (error.code === 'EEXIST') console.log('.env already exists; credentials were preserved.'); else throw error; }
