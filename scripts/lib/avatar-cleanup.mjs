import { localServiceConfig } from "./local-service-config.mjs";

export async function processLocalAvatarCleanup(values, request = fetch) {
  const config = localServiceConfig(values);
  const send = (path, body, method = "POST") =>
    request(`${config.origin}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers: {
        "Content-Type": "application/json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(body),
    });
  const response = await send("/rest/v1/rpc/worker_avatar_cleanup", {
    p_limit: 20,
  });
  if (!response.ok) throw new Error("Local avatar cleanup unavailable");
  const jobs = await response.json();
  const pathPattern =
    /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/i;
  if (
    !Array.isArray(jobs) ||
    jobs.length > 20 ||
    jobs.some(
      (job) =>
        !job ||
        !["dog-avatars", "community-avatars"].includes(job.bucket_id) ||
        typeof job.object_path !== "string" ||
        !pathPattern.test(job.object_path),
    )
  )
    throw new Error("Invalid cleanup response");
  const result = { completed: 0, failed: 0 };
  for (const job of jobs) {
    const params = { p_bucket: job.bucket_id, p_path: job.object_path };
    try {
      const removed = await send(
        `/storage/v1/object/${job.bucket_id}`,
        { prefixes: [job.object_path] },
        "DELETE",
      );
      if (!removed.ok) throw new Error("Removal failed");
      const acknowledged = await send(
        "/rest/v1/rpc/worker_finish_avatar_cleanup",
        { ...params, p_failed: false },
      );
      if (!acknowledged.ok) throw new Error("Removal unconfirmed");
      result.completed++;
    } catch {
      result.failed++;
      try {
        await send("/rest/v1/rpc/worker_finish_avatar_cleanup", {
          ...params,
          p_failed: true,
        });
      } catch {
        /* Durable entry remains pending. */
      }
    }
  }
  return result;
}
