import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { createServer } from './server.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const { server } = createServer({ db, config });
console.log(`[badge] listening on http://localhost:${server.port} (db=${config.databasePath})`);

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  server.stop(true);
  db.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
