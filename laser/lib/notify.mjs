// macOS notification when a job needs the operator. Fire-and-forget: a failed notification never affects the queue.
// The text goes to osascript as argv (through `on run argv`), never spliced into the script, so order data cannot inject AppleScript.
import { execFile } from 'node:child_process';
import { log } from './log.mjs';

export const OSASCRIPT = '/usr/bin/osascript';
export const NOTIFY_TIMEOUT_MS = 3000;
const MAX_BODY = 200;

// Control characters and line breaks make a poor notification (and some are not valid in argv); fold them to spaces.
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// What goes in the log when a notification fails: a code or signal, never err.message. execFile's message is "Command failed:
// <bin> <every argv item>", which on a timeout (code null) would put the notification body, and so order data, in the log.
const why = (e) => String((e && (e.code ?? e.signal ?? e.name)) || 'error').slice(0, 40);

// Building the argv is separate so tests can assert it exactly.
export function notifyArgs({ title, body }) {
  return ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', '--', clean(body, MAX_BODY), clean(title, 80)];
}

// exec: injected stub (bin, args, opts, cb) for tests. Without one, tests (NODE_ENV=test, or the node test runner's child
// processes) are a no-op so `npm test` never pops a real notification. Resolves true when a notification was sent.
export function notify({ title = 'Salty Dog Tags', body, config, exec }) {
  if (config && config.notify === false) return Promise.resolve(false);
  const underTest = process.env.NODE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT;
  const run = exec || (underTest ? null : execFile);
  if (!run) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      run(OSASCRIPT, notifyArgs({ title, body }), { timeout: NOTIFY_TIMEOUT_MS }, (err) => {
        if (err) { log.warn(`notify failed: ${why(err)}`); resolve(false); } else resolve(true);
      });
    } catch (e) {
      log.warn(`notify failed: ${why(e)}`);
      resolve(false);
    }
  });
}
