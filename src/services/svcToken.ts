import { config } from "../config.js"

/**
 * Mints and caches (until 30 s before expiry) a client_credentials access token
 * for the service client, used for Catalogue calls without a user. Returns null
 * when no svc secret is configured, logging a warning once.
 */

let cached: { token: string; expiresAt: number } | null = null
let warnedDisabled = false

export async function getSvcToken(): Promise<string | null> {
  if (!config.keycloak.svc.secret) {
    if (!warnedDisabled) {
      console.warn(
        "[svc] KEYCLOAK_SVC_CLIENT_SECRET unset — service-to-service Catalogue calls disabled"
      )
      warnedDisabled = true
    }
    return null
  }

  const now = Date.now()
  if (cached && now < cached.expiresAt) return cached.token

  let res: Response
  try {
    res = await fetch(config.keycloak.svc.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.keycloak.svc.clientId,
        client_secret: config.keycloak.svc.secret,
      }),
    })
  } catch (err) {
    console.error("[svc] token request errored:", err)
    return null
  }
  if (!res.ok) {
    console.error(`[svc] token request failed: ${res.status}`)
    return null
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = {
    token: json.access_token,
    expiresAt: now + (json.expires_in - 30) * 1000,
  }
  return cached.token
}
