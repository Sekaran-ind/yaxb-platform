// Sign in with Google (IDN-14) through OpenID Connect, with PKCE, state and nonce, using oauth4webapi
// for the protocol (IDN-54). The client secret stays on the server. What comes back is the provider's
// subject id and whether the email is verified: the identity service keeps only a keyed hash of the
// subject and the masked email.
//
//   start     the address to send the person to, and what to keep until they return (in a short,
//             sealed, host-only cookie): the PKCE verifier, the state and the nonce
//   finish    the returned address checked against what was kept; the code exchanged; the ID token's
//             claims validated (issuer, audience, nonce, expiry)
import * as oauth from "oauth4webapi";

export type OidcProvider = { id: "google"; issuer: string; clientId: string; clientSecret: string; redirectUri: string };
export type OidcPending = { verifier: string; state: string; nonce: string; at: number };
export type OidcResult = { subject: string; email: string | null; emailVerified: boolean; name: string | null };

export const GOOGLE_ISSUER = "https://accounts.google.com";
/** How long the person has to come back from the provider. */
export const OIDC_MINUTES = 10;

const discovered = new Map<string, Promise<oauth.AuthorizationServer>>();
function server(issuer: string, fetchImpl?: typeof fetch): Promise<oauth.AuthorizationServer> {
  let as = discovered.get(issuer);
  if (!as) {
    const url = new URL(issuer);
    as = oauth
      .discoveryRequest(url, { algorithm: "oidc", ...(fetchImpl ? { [oauth.customFetch]: fetchImpl } : {}) })
      .then((r) => oauth.processDiscoveryResponse(url, r))
      .catch((e: unknown) => {
        discovered.delete(issuer);
        throw e;
      });
    discovered.set(issuer, as);
  }
  return as;
}

/** Where to send the person, and what to keep until they come back. */
export async function oidcStart(p: OidcProvider, { fetchImpl, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<{ url: string; pending: OidcPending }> {
  const as = await server(p.issuer, fetchImpl);
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();
  const url = new URL(as.authorization_endpoint!);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");
  return { url: url.href, pending: { verifier, state, nonce, at: now } };
}

/** Check the provider's answer and read who it is. Throws on anything unexpected. */
export async function oidcFinish(p: OidcProvider, current: URL, pending: OidcPending, { fetchImpl, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<OidcResult> {
  if (now - pending.at > OIDC_MINUTES * 60_000) throw new Error("The sign-in took too long.");
  const as = await server(p.issuer, fetchImpl);
  const client: oauth.Client = { client_id: p.clientId };
  const params = oauth.validateAuthResponse(as, client, current, pending.state);
  const extra = fetchImpl ? { [oauth.customFetch]: fetchImpl } : {};
  const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.ClientSecretPost(p.clientSecret), params, p.redirectUri, pending.verifier, extra);
  const result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: pending.nonce, requireIdToken: true });
  const claims = oauth.getValidatedIdTokenClaims(result)!;
  return {
    subject: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}
