import { timingSafeEqual } from "node:crypto";

export type LoopbackAccessPolicy = {
  bearer: string | null;
  allowedOrigins: ReadonlySet<string>;
};

export type LoopbackAccessFailure = 401 | 403;

export function consumeLoopbackAccessEnvironment(
  environment: NodeJS.ProcessEnv
): LoopbackAccessPolicy {
  const bearer = environment.MARGINALIA_LOOPBACK_BEARER ?? null;
  const allowedOrigin = environment.MARGINALIA_ALLOWED_ORIGIN;
  delete environment.MARGINALIA_LOOPBACK_BEARER;
  delete environment.MARGINALIA_ALLOWED_ORIGIN;
  return {
    bearer,
    allowedOrigins: new Set(allowedOrigin ? [allowedOrigin] : [])
  };
}

export function isAllowedOrigin(origin: string | null, policy: LoopbackAccessPolicy): boolean {
  return origin !== null && policy.allowedOrigins.has(origin);
}

function bearerMatches(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function authorizeLoopbackAccess(
  request: Request,
  policy: LoopbackAccessPolicy
): LoopbackAccessFailure | null {
  if (!isAllowedOrigin(request.headers.get("origin"), policy)) return 403;
  if (!policy.bearer) return 401;
  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${policy.bearer}`;
  return authorization !== null && bearerMatches(authorization, expected) ? null : 401;
}
