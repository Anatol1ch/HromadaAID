export type GoogleOAuthTokens = {
  access_token: string
  refresh_token: string
}

type TokenEndpointResponse = {
  access_token?: unknown
  refresh_token?: unknown
  error?: unknown
}

const safeGoogleErrorCodes = new Set([
  'invalid_client', 'invalid_grant', 'redirect_uri_mismatch', 'unauthorized_client',
  'invalid_request', 'unsupported_grant_type', 'access_denied', 'temporarily_unavailable',
])

export class GoogleOAuthExchangeError extends Error {
  constructor(readonly googleErrorCode: string, message: string) {
    super(message)
    this.name = 'GoogleOAuthExchangeError'
  }
}

function messageForGoogleError(code: string): string {
  switch (code) {
    case 'invalid_client':
      return 'Google відхилив OAuth-клієнт. Перевірте, що Client ID і Client Secret (якщо заданий) належать одному Desktop OAuth-клієнту.'
    case 'invalid_grant':
      return 'Google відхилив код авторизації. Він міг застаріти або бути використаний раніше; перевірте відповідність PKCE та redirect URI й запустіть підключення заново.'
    case 'redirect_uri_mismatch':
      return 'Google повідомив про невідповідність redirect URI. Використайте Desktop OAuth-клієнт і повторіть повний процес підключення.'
    case 'unauthorized_client':
      return 'Цей OAuth-клієнт не має дозволу на такий тип авторизації. Перевірте його тип у Google Cloud Console.'
    case 'invalid_request':
      return 'Google відхилив параметри запиту авторизації. Перевірте налаштування Desktop OAuth-клієнта та повторіть підключення.'
    default:
      return 'Google не прийняв обмін коду авторизації. Перевірте налаштування OAuth Desktop-клієнта та повторіть підключення.'
  }
}

/** Exchanges one authorization code. The code, verifier, client secret and token response are never logged. */
export async function exchangeGoogleAuthorizationCode(
  input: { clientId: string; clientSecret?: string; code: string; codeVerifier: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<GoogleOAuthTokens> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  })
  if (input.clientSecret) body.set('client_secret', input.clientSecret)

  let response: Response
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    throw new Error('Не вдалося з’єднатися з Google для обміну коду авторизації. Перевірте інтернет-з’єднання та повторіть підключення.')
  }

  let result: TokenEndpointResponse
  try {
    result = await response.json() as TokenEndpointResponse
  } catch {
    throw new Error('Google повернув некоректну відповідь під час обміну коду авторизації.')
  }

  if (!response.ok) {
    const code = typeof result.error === 'string' && safeGoogleErrorCodes.has(result.error) ? result.error : 'unknown_error'
    throw new GoogleOAuthExchangeError(code, messageForGoogleError(code))
  }
  if (typeof result.access_token !== 'string' || result.access_token.length === 0 || typeof result.refresh_token !== 'string' || result.refresh_token.length === 0) {
    throw new Error('Google не надав потрібні дані авторизації. Повторіть підключення з доступом до Google Drive.')
  }
  return { access_token: result.access_token, refresh_token: result.refresh_token }
}
