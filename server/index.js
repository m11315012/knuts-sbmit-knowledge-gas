import { pool, initializeDatabase } from './db.js';
import { createApp } from './app.js';
try {
  await initializeDatabase();
  const { app, store } = await createApp();
  const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('CORPO is ready on port ' + (process.env.PORT || 3000)));
  const stop = () => { server.close(async () => { store.close(); await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch (error) { console.error('Startup failed:', error.message); await pool.end(); process.exit(1); }
