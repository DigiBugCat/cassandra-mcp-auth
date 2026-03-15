/**
 * ACL client for checking tool-level authorization against the centralized ACL service.
 * Also fetches per-user credentials from the ACL service.
 */

export interface AclEnv {
  ACL_URL: string;
  ACL_SECRET: string;
}

export interface AclCheckResult {
  allowed: boolean;
  reason: string;
}

/**
 * Check if a user is allowed to use a specific tool on a service.
 */
export async function checkACL(
  env: AclEnv,
  email: string,
  service: string,
  tool: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${env.ACL_URL}/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACL-Secret": env.ACL_SECRET,
      },
      body: JSON.stringify({ email, service, tool }),
    });

    if (!res.ok) return false;

    const result = (await res.json()) as AclCheckResult;
    return result.allowed;
  } catch {
    // ACL service unavailable — fail open for now (log + metric would be good)
    return true;
  }
}

/**
 * Fetch per-user credentials from the ACL service.
 */
export async function fetchUserCredentials<T extends Record<string, string> = Record<string, string>>(
  env: AclEnv,
  email: string,
  service: string,
): Promise<T | null> {
  try {
    const res = await fetch(`${env.ACL_URL}/credentials/${encodeURIComponent(email)}/${encodeURIComponent(service)}`, {
      headers: { "X-ACL-Secret": env.ACL_SECRET },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { credentials: T | null };
    return data.credentials;
  } catch {
    return null;
  }
}
