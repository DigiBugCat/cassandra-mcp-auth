import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: this.code,
        error_description: this.description,
      }),
      {
        status: this.statusCode,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

export interface OAuthStateResult {
  stateToken: string;
}

export interface ValidateStateResult {
  oauthReqInfo: AuthRequest;
  clearCookie: string;
}

export interface BindStateResult {
  setCookie: string;
}

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  stateTTL = 600,
): Promise<OAuthStateResult> {
  const stateToken = crypto.randomUUID();
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: stateTTL,
  });
  return { stateToken };
}

export async function bindStateToSession(stateToken: string): Promise<BindStateResult> {
  const consentedStateCookieName = "__Host-CONSENTED_STATE";
  return {
    setCookie: `${consentedStateCookieName}=${stateToken}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`,
  };
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<ValidateStateResult> {
  const consentedStateCookieName = "__Host-CONSENTED_STATE";
  const url = new URL(request.url);

  // Read state token from cookie (set during /authorize)
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((value) => value.trim());
  const consentedStateCookie = cookies.find((value) =>
    value.startsWith(`${consentedStateCookieName}=`),
  );
  const stateFromCookie = consentedStateCookie
    ? consentedStateCookie.substring(consentedStateCookieName.length + 1)
    : null;

  // Use state from query param if available, fall back to cookie.
  // WorkOS AuthKit doesn't always pass state back in the redirect URL.
  const stateToken = url.searchParams.get("state") || stateFromCookie;
  if (!stateToken) {
    throw new OAuthError(
      "invalid_request",
      "Missing state parameter and no session cookie - authorization flow must be restarted",
      400,
    );
  }

  const storedDataJson = await kv.get(`oauth:state:${stateToken}`);
  if (!storedDataJson) {
    throw new OAuthError("invalid_request", "Invalid or expired state", 400);
  }

  // When state comes from query, verify it matches the cookie for CSRF protection
  const stateFromQuery = url.searchParams.get("state");
  if (stateFromQuery && stateFromCookie && stateFromQuery !== stateFromCookie) {
    throw new OAuthError(
      "invalid_request",
      "State token does not match session - possible CSRF attack detected",
      400,
    );
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(storedDataJson) as AuthRequest;
  } catch {
    throw new OAuthError("server_error", "Invalid state data", 500);
  }

  await kv.delete(`oauth:state:${stateToken}`);

  return {
    oauthReqInfo,
    clearCookie: `${consentedStateCookieName}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`,
  };
}

