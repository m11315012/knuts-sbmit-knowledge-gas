import { mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('backups', { recursive: true });
const path = resolve('backups', 'corpo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump');
const file = await open(path, 'wx', 0o600);
const taskProcess = spawn('docker', ['compose','exec','-T','db','pg_dump','-U','corpo','-d','corpo','-Fc'], { stdio: ['ignore', file.fd, 'inherit'] });
await new Promise((resolve, reject) => { taskProcess.once('error', reject); taskProcess.once('exit', code => code === 0 ? resolve() : reject(new Error('Backup failed with exit code ' + code))); });
await file.close(); console.log('Database backup saved: ' + path);
