import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { config } from "../config.js"
import type { AuthUser } from "../types/api.js"

/**
 * Offline JWT verification against Keycloak. The JWKS is fetched from the
 * configured (possibly docker-internal) URL and cached by jose, including
 * key-rotation refetches.
 */

const jwks = createRemoteJWKSet(new URL(config.keycloak.jwksUri), {
  cacheMaxAge: 10 * 60 * 1000,
})

export class AuthError extends Error {
  statusCode = 401
}

interface KeycloakClaims extends JWTPayload {
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
  azp?: string
}

export async function verifyToken(token: string): Promise<AuthUser> {
  let payload: KeycloakClaims
  try {
    const result = await jwtVerify<KeycloakClaims>(token, jwks, {
      issuer: config.keycloak.issuer,
    })
    payload = result.payload
  } catch {
    throw new AuthError("Invalid or expired token")
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []

  // Platform audience check; skipped when no required audience is configured.
  if (config.keycloak.requiredAudience && !aud.includes(config.keycloak.requiredAudience)) {
    throw new AuthError("Token is missing the required audience")
  }

  // Keycloak puts the requesting client in `azp` (`aud` is often "account");
  // either must match this application's client id.
  if (payload.azp !== config.keycloak.clientId && !aud.includes(config.keycloak.clientId)) {
    throw new AuthError("Token was not issued for this application")
  }

  if (!payload.sub) throw new AuthError("Token has no subject")
  if (!payload.email) throw new AuthError("Token has no email claim")
  // Unverified emails are rejected: email is used as an identity claim.
  if (payload.email_verified !== true) {
    throw new AuthError("Email address is not verified")
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? payload.preferred_username,
  }
}
