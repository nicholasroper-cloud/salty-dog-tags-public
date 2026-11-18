// Daemon entry: lock, config, state, scheduler, HTTP, UDP client.
import { boot } from './lib/runtime.mjs';
import { createHttp } from './lib/http.mjs';
import { LockHeldError } from './lib/lock.mjs';
import { ConfigError } from './lib/config.mjs';
import { log } from './lib/log.mjs';

let rt;
try {
  rt = await boot({ echoLog: !!process.env.SDT_LOG_STDERR });
} catch (e) {
  if (e instanceof LockHeldError) { log.info(`another instance is running (${e.message}); exiting 0`); console.error('another instance is running'); process.exit(0); }
  if (e instanceof ConfigError) { log.error(e.message); console.error(e.message); process.exit(1); }
  log.error(`startup failed: ${e.stack || e.message}`);
  console.error(e.stack || e.message);
  process.exit(1);
}

const web = createHttp({ queue: rt.queue, config: rt.config });
try {
  const port = await web.listen();
  log.info(`sdt-laser 1.0.0 up: http://127.0.0.1:${port} queue=${rt.config.queueDir} plan=${rt.config.kvPlan}`);
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    log.info('another instance is running (UI port in use); exiting 0');
    await rt.shutdown();
    process.exit(0);
  }
  log.error(`http listen failed: ${e.message}`);
  await rt.shutdown();
  process.exit(1);
}

rt.lightburn.startBackgroundPing();
rt.queue.probeQueue().then(() => rt.queue.startPolling());

let stopping = false;
async function stop(sig) {
  if (stopping) return;
  stopping = true;
  log.info(`${sig} received, shutting down`);
  await web.close();
  await rt.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (e) => log.error(`unhandledRejection: ${e && e.stack ? e.stack : e}`));
