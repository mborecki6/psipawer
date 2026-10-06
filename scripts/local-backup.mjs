import {
  createLocalBackup,
  verifyLocalBackup,
  recoverBackup,
  recoverRestore,
} from "./lib/local-backup.mjs";

try {
  const [command, id, run, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["create", "verify", "recover", "recover-restore"].includes(command) ||
    (command === "create" ? id : !id) ||
    (command === "recover-restore" ? !run : run)
  )
    throw new Error(
      "Użycie: pnpm local:backup create | verify ID | recover ID | recover-restore ID_KOPII ID_ODTWORZENIA",
    );
  if (command === "create") await createLocalBackup();
  else if (command === "verify") await verifyLocalBackup(id);
  else if (command === "recover") await recoverBackup(id);
  else await recoverRestore(id, run);
} catch {
  console.error(
    "Operacja lokalnej kopii nie zakończyła się poprawnie. Sprawdź prywatny manifest i log w .local/backups/. Nie resetuj bazy ani nie usuwaj zasobów źródłowych.",
  );
  process.exitCode = 1;
}
