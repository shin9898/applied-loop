import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function authorizeWorker(argv, env) {
  if (argv.length === 0) return { ok: false, code: "worker_disabled" };
  if (argv.length !== 1 || argv[0] !== "--once") {
    return { ok: false, code: "worker_invalid_arguments" };
  }
  if (env.LOOP_JOB_WORKER_ENABLED !== "1") {
    return { ok: false, code: "worker_disabled" };
  }

  const raw = env.LOOP_JOB_DATABASE_URL;
  if (typeof raw !== "string") return { ok: false, code: "worker_database_url_invalid" };
  let url;
  let databasePath;
  try {
    url = new URL(raw);
    if (
      raw !== url.href ||
      url.protocol !== "file:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.host !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return { ok: false, code: "worker_database_url_invalid" };
    }
    databasePath = fileURLToPath(url);
    if (databasePath.includes("\0") || !isAbsolute(databasePath) || raw !== pathToFileURL(databasePath).href) {
      return { ok: false, code: "worker_database_url_invalid" };
    }
  } catch {
    return { ok: false, code: "worker_database_url_invalid" };
  }

  try {
    if (!statSync(databasePath).isFile()) return { ok: false, code: "worker_database_unavailable" };
  } catch {
    return { ok: false, code: "worker_database_unavailable" };
  }
  return { ok: true, databasePath };
}
