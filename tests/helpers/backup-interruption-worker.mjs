// Real operation paused by an observer after the reported stage has finished.
// Only the parent harness decides when to signal this confirmed child process.
import {
  createLocalBackup,
  verifyLocalBackup,
} from "../../scripts/lib/local-backup.mjs";

const [mode, barrier, id] = process.argv.slice(2);
// A pending Promise and signal listeners do not keep Node's event loop alive.
// The controlled barrier must remain a genuinely live process until signalled.
const keepAlive = setInterval(() => {}, 1000);
const onStage = async (details) => {
  if (details.phase !== barrier) return;
  process.send?.({ ...details, pid: process.pid });
  await new Promise(() => {});
};
try {
  if (mode === "create") await createLocalBackup({ onStage });
  else if (mode === "verify")
    await verifyLocalBackup(id, undefined, { onStage });
  else throw new Error("Unknown worker mode");
  process.exitCode = 0;
} catch {
  process.exitCode = 71;
} finally {
  clearInterval(keepAlive);
  process.disconnect?.();
}
