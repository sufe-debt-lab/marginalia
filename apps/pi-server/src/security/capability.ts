export type CapabilityPolicy = {
  token: string | null;
  allowedOrigins: ReadonlySet<string>;
};

export type CapabilityFailure = 401 | 403;

export function isAllowedOrigin(origin: string | null, policy: CapabilityPolicy): boolean {
  return origin === null || origin === "null" || policy.allowedOrigins.has(origin);
}

export function authorizeCapability(
  request: Request,
  policy: CapabilityPolicy
): CapabilityFailure | null {
  if (!isAllowedOrigin(request.headers.get("origin"), policy)) return 403;
  const expected = policy.token;
  if (!expected) return 401;
  return request.headers.get("authorization") === `Bearer ${expected}` ? null : 401;
}
