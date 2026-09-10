import { z } from 'zod';
export const account = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.@-]+$/).transform(value => value.toLowerCase());
export const password = z.string().min(12).max(128);
export const loginSchema = z.object({ account, password: z.string().min(1).max(128) }).strict();
export const submissionSchema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1).max(100), email: z.email().max(254),
  identity: z.string().trim().min(1).max(50),
  folderUrl: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }),
  notes: z.string().trim().max(5000).default('')
}).strict();
export const decisionSchema = z.object({ version: z.number().int().positive(), action: z.enum(['APPROVE','REJECT','IMPORT']), note: z.string().trim().max(2000).default('') }).strict().refine(data => data.action !== 'REJECT' || data.note.length > 0, { message: '退回時請填寫原因。' });
export const userSchema = z.object({ account, name: z.string().trim().min(1).max(100), role: z.enum(['ADMIN','STAFF']), enabled: z.boolean(), password: z.union([password,z.literal('')]), version: z.number().int().positive().optional() }).strict();
export const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), filter: z.enum(['ALL','PENDING','APPROVED','REJECTED','IMPORTED','ARCHIVED']).default('ALL'), search: z.string().trim().max(200).default('') });
export const uuid = z.uuid();
export const batchCaseSchema = z.object({ action: z.enum(['ARCHIVE', 'DELETE']), ids: z.array(uuid).min(1).max(100) }).strict().refine(data => new Set(data.ids).size === data.ids.length, { message: '案件不可重複。' });
export function problem(status, message) { return Object.assign(new Error(message), { status }); }
