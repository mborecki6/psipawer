import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  readFileSync,
  writeSync,
  fsyncSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  resolve,
  relative,
  isAbsolute,
  sep,
} from "node:path";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/;
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
export class AccessError extends Error {
  constructor(code) {
    super(code);
    this.name = "AccessError";
  }
}
/** @returns {never} */
const fail = (code) => {
  throw new AccessError(code);
};

export function privateAccessFiles(
  root,
  selectedRoot = resolve(
    homedir(),
    ".local/share/psi-pawer/manual-client-access",
  ),
) {
  if (typeof selectedRoot !== "string" || !isAbsolute(selectedRoot))
    fail("absolute_private_directory_required");
  const repositoryRoot = realpathSync(root);
  const contained = (parent, path) => {
    const rel = relative(parent, path);
    return (
      !rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    );
  };
  function noSymlinks(path) {
    let current = resolve(path);
    while (current !== dirname(current)) {
      try {
        if (lstatSync(current).isSymbolicLink()) fail("symlink_not_allowed");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      current = dirname(current);
    }
  }
  // Resolve the existing parent even when the dedicated directory does not
  // exist yet. Inspecting configuration never creates the default directory.
  function canonicalFuture(path) {
    let parent = resolve(path);
    const suffix = [];
    while (true) {
      try {
        lstatSync(parent);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        suffix.unshift(basename(parent));
        parent = dirname(parent);
      }
    }
    noSymlinks(parent);
    return resolve(realpathSync(parent), ...suffix);
  }
  const privateRoot = canonicalFuture(selectedRoot);
  if (contained(repositoryRoot, privateRoot))
    fail("private_directory_in_repository");
  function privatePath(path) {
    const full = resolve(root, path);
    if (contained(repositoryRoot, full)) fail("private_path_in_repository");
    const rel = relative(privateRoot, full);
    if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
      fail("private_path_required");
    noSymlinks(full);
    if (contained(repositoryRoot, canonicalFuture(full)))
      fail("private_path_in_repository");
    return full;
  }
  function checkDirectories(full) {
    let dir = dirname(full);
    while (dir !== dirname(privateRoot)) {
      const stat = lstatSync(dir);
      if (
        !stat.isDirectory() ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        fail("private_directory_permissions_required");
      dir = dirname(dir);
    }
  }
  return {
    privateRoot,
    read(path) {
      const full = privatePath(path);
      checkDirectories(full);
      const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          (stat.mode & 0o077) !== 0 ||
          stat.uid !== process.getuid?.() ||
          stat.nlink !== 1 ||
          stat.size > 2 * 1024 * 1024
        )
          fail("private_file_permissions_required");
        return JSON.parse(readFileSync(fd, "utf8"));
      } finally {
        closeSync(fd);
      }
    },
    open(path) {
      const full = privatePath(path);
      mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
      noSymlinks(full);
      checkDirectories(full);
      const fd = openSync(
        full,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      fchmodSync(fd, 0o600);
      return { fd, full };
    },
  };
}

// Append-only journal: a crash cannot erase the durable pre-request entry.
export function writeAccessCheckpoint(fd, value) {
  const buffer = Buffer.from(JSON.stringify(value) + "\n");
  let offset = 0;
  while (offset < buffer.length)
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  fsyncSync(fd);
}

export function accessTarget(values, allowHosted = false) {
  try {
    const db = new URL(values.PSI_MANUAL_SUPABASE_URL);
    const app = new URL(values.PSI_MANUAL_APP_ORIGIN);
    for (const url of [db, app]) {
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !["http:", "https:"].includes(url.protocol)
      )
        fail("invalid_target");
    }
    const local = loopback(db.hostname);
    if (
      local !== loopback(app.hostname) ||
      (!local &&
        (!allowHosted || db.protocol !== "https:" || app.protocol !== "https:"))
    )
      fail("target_not_allowed");
    return {
      supabaseOrigin: db.origin,
      appOrigin: app.origin,
      environment: local ? "local" : "hosted",
    };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    fail("invalid_target");
  }
}

export function accessRecipients(input) {
  if (
    input?.version !== 1 ||
    !Array.isArray(input.recipients) ||
    input.recipients.length < 1 ||
    input.recipients.length > 500
  )
    fail("invalid_input");
  const rows = new Map();
  for (const row of input.recipients) {
    if (
      !row ||
      typeof row.email !== "string" ||
      !["new", "access"].includes(row.intent)
    )
      fail("invalid_recipient");
    const email = row.email.trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email))
      fail("invalid_recipient");
    if (rows.has(email) && rows.get(email).intent !== row.intent)
      fail("conflicting_intents");
    rows.set(email, { email, intent: row.intent });
  }
  return [...rows.values()];
}

/** @typedef {{seconds: number, source: string, checkedAt: string, supabaseOrigin?: string}} AccessExpiryEvidence */
/**
 * @param {AccessExpiryEvidence | null} input
 * @param {Date} now
 * @param {string | null} targetOrigin
 */
export function expiryEvidence(input, now = new Date(), targetOrigin = null) {
  if (input == null) return null;
  const managementSource =
    /^Supabase Management GET \/v1\/projects\/([a-z0-9]+)\/config\/auth:mailer_otp_exp$/.exec(
      input.source || "",
    );
  const origin =
    input.supabaseOrigin ||
    (managementSource ? `https://${managementSource[1]}.supabase.co` : null);
  if (
    !Number.isSafeInteger(input.seconds) ||
    input.seconds < 1 ||
    input.seconds > 604800 ||
    typeof input.source !== "string" ||
    (!managementSource &&
      !["management-auth-config", "local-auth-config"].includes(
        input.source,
      )) ||
    !Number.isFinite(Date.parse(input.checkedAt)) ||
    Date.parse(input.checkedAt) > now.getTime() ||
    typeof origin !== "string"
  )
    fail("invalid_expiry_evidence");
  if (targetOrigin && origin !== targetOrigin) fail("expiry_target_mismatch");
  return {
    seconds: input.seconds,
    source: input.source,
    checkedAt: input.checkedAt,
    supabaseOrigin: origin,
  };
}

function digest(plan) {
  const { digest: ignored, ...content } = plan;
  void ignored;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

// Iterate numeric pages ourselves: auth-js 2.115's nextPage parser truncates
// multi-digit page numbers. Never infer absence from the first 1000 users.
export async function directory(adapter) {
  const users = [],
    ids = new Set();
  for (let page = 1; page <= 10000; page++) {
    const batch = await adapter.listUsers(page, 200);
    if (!Array.isArray(batch) || batch.length > 200) fail("directory_invalid");
    for (const user of batch) {
      if (!user?.id || ids.has(user.id)) fail("directory_changed");
      ids.add(user.id);
      users.push(user);
    }
    if (batch.length < 200) return users;
  }
  fail("directory_limit");
}

async function classify(recipient, users, adapter) {
  const matches = users.filter(
    (u) => u.email?.trim().toLowerCase() === recipient.email,
  );
  if (matches.length > 1)
    return { ...recipient, status: "blocked", reason: "ambiguous_identity" };
  const user = matches[0];
  if (!user)
    return recipient.intent === "new"
      ? { ...recipient, status: "planned", userId: null, tokenType: "invite" }
      : { ...recipient, status: "blocked", reason: "account_missing" };
  const identity = await adapter.identity(user.id);
  if (identity?.role === "admin")
    return { ...recipient, status: "blocked", reason: "staff_account" };
  if (
    identity?.role !== "client" ||
    identity.userId !== user.id ||
    identity.profileId !== user.id
  )
    return { ...recipient, status: "blocked", reason: "inconsistent_identity" };
  if (recipient.intent === "new")
    return { ...recipient, status: "blocked", reason: "account_exists" };
  if (user.banned_until && Date.parse(user.banned_until) > Date.now())
    return { ...recipient, status: "blocked", reason: "account_unavailable" };
  return {
    ...recipient,
    status: "planned",
    userId: user.id,
    tokenType: "magiclink",
  };
}

export async function planAccess({
  input,
  adapter,
  target,
  expiry = /** @type {AccessExpiryEvidence | null} */ (null),
  now = new Date(),
}) {
  const recipients = accessRecipients(input);
  const evidence = expiryEvidence(expiry, now, target.supabaseOrigin);
  const users = await directory(adapter);
  const rows = [];
  for (const recipient of recipients)
    rows.push(await classify(recipient, users, adapter));
  const plan = {
    version: 1,
    kind: "manual-client-access-plan",
    id: randomUUID(),
    createdAt: now.toISOString(),
    target,
    expiry: evidence,
    rows,
  };
  return { ...plan, digest: digest(plan) };
}

export function validatePlan(plan, target) {
  if (
    plan?.version !== 1 ||
    plan.kind !== "manual-client-access-plan" ||
    typeof plan.id !== "string" ||
    plan.digest !== digest(plan) ||
    JSON.stringify(plan.target) !== JSON.stringify(target) ||
    !Array.isArray(plan.rows) ||
    plan.rows.length < 1 ||
    plan.rows.some((r) => r.status !== "planned")
  )
    fail("plan_not_applicable");
  const rows = accessRecipients({ version: 1, recipients: plan.rows });
  if (rows.length !== plan.rows.length) fail("plan_not_applicable");
  for (const row of plan.rows) {
    if (
      row.email !== row.email.trim().toLowerCase() ||
      (row.intent === "new" &&
        (row.userId !== null || row.tokenType !== "invite")) ||
      (row.intent === "access" &&
        (typeof row.userId !== "string" || row.tokenType !== "magiclink"))
    )
      fail("plan_not_applicable");
  }
  const evidence = expiryEvidence(plan.expiry);
  if (evidence && evidence.supabaseOrigin !== target.supabaseOrigin)
    fail("expiry_target_mismatch");
}

export async function applyAccess({
  plan,
  adapter,
  target,
  checkpoint,
  now = () => new Date(),
}) {
  validatePlan(plan, target);
  // Whole-batch preflight before the first mutation, then fresh checks per row.
  const preflight = await directory(adapter);
  for (const row of plan.rows) {
    const current = await classify(row, preflight, adapter);
    if (JSON.stringify(current) !== JSON.stringify(row)) fail("plan_changed");
  }
  const records = [];
  for (let index = 0; index < plan.rows.length; index++) {
    const row = plan.rows[index];
    const current = await classify(row, await directory(adapter), adapter);
    if (JSON.stringify(current) !== JSON.stringify(row)) fail("plan_changed");
    /** @type {{index: number, email: string, intent: string, userId: string | null, tokenType: string, status: string, issuedAt: string | null, expiresAt: string | null, expiryStatus: string, url?: string, reason?: string}} */
    const record = {
      index,
      email: row.email,
      intent: row.intent,
      userId: row.userId,
      tokenType: row.tokenType,
      status: "pending",
      issuedAt: null,
      expiresAt: null,
      expiryStatus: "unverified",
    };
    await checkpoint({ ...record }); // Must be durable BEFORE the Auth request.
    records.push(record);
    let data;
    try {
      data = await adapter.generateLink({
        type: row.tokenType,
        email: row.email,
      });
    } catch {
      record.status = "uncertain";
      record.reason = "provider_result_unknown";
      await checkpoint({ ...record });
      break; // No automatic retry after a possibly accepted request.
    }
    const user = data?.user,
      properties = data?.properties;
    let identity;
    try {
      identity = user?.id ? await adapter.identity(user.id) : null;
    } catch {
      identity = null;
    }
    if (
      !user?.id ||
      user.email?.trim().toLowerCase() !== row.email ||
      (row.userId && user.id !== row.userId) ||
      properties?.verification_type !== row.tokenType ||
      !tokenPattern.test(properties?.hashed_token || "") ||
      identity?.role !== "client" ||
      identity.userId !== user.id ||
      identity.profileId !== user.id
    ) {
      record.status = "uncertain";
      record.reason = "provider_identity_unconfirmed";
      await checkpoint({ ...record });
      break;
    }
    record.status = "ready";
    record.userId = user.id;
    record.issuedAt = now().toISOString();
    const sentAt =
      row.tokenType === "invite"
        ? user.confirmation_sent_at
        : user.recovery_sent_at;
    if (plan.expiry && Number.isFinite(Date.parse(sentAt))) {
      record.expiresAt = new Date(
        Date.parse(sentAt) + plan.expiry.seconds * 1000,
      ).toISOString();
      record.expiryStatus = "configured";
    }
    const link = new URL(
      row.tokenType === "invite" ? "/auth/invitation" : "/auth/access",
      target.appOrigin,
    );
    link.searchParams.set("token_hash", properties.hashed_token);
    record.url = link.href;
    await checkpoint({ ...record });
  }
  return {
    complete:
      records.length === plan.rows.length &&
      records.every((r) => r.status === "ready"),
    records,
  };
}

export function supabaseAccessAdapter(client) {
  return {
    async listUsers(page, perPage) {
      const result = await client.auth.admin.listUsers({ page, perPage });
      if (result.error) fail("directory_unavailable");
      return result.data.users;
    },
    async identity(id) {
      const [role, profile] = await Promise.all([
        client
          .from("user_roles")
          .select("user_id,role")
          .eq("user_id", id)
          .single(),
        client.from("profiles").select("id").eq("id", id).single(),
      ]);
      if (role.error || profile.error) fail("identity_unavailable");
      return {
        userId: role.data?.user_id,
        role: role.data?.role,
        profileId: profile.data?.id,
      };
    },
    async generateLink(params) {
      const result = await client.auth.admin.generateLink(params);
      if (result.error) fail("provider_unavailable");
      return result.data;
    },
  };
}
