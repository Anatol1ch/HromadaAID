import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exchangeGoogleAuthorizationCode, GoogleOAuthExchangeError } from './google-oauth.js'

const request = {
  clientId: 'synthetic-client-id',
  clientSecret: 'synthetic-client-secret',
  code: 'synthetic-authorization-code',
  codeVerifier: 'synthetic-code-verifier',
  redirectUri: 'http://127.0.0.1:43210/oauth2/callback',
}

test('Google OAuth code exchange sends the matching PKCE verifier and redirect URI', async () => {
  let submitted: URLSearchParams | undefined
  const tokens = await exchangeGoogleAuthorizationCode(request, async (_url, init) => {
    submitted = new URLSearchParams(String(init?.body))
    return Response.json({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' })
  })

  assert.equal(submitted?.get('client_id'), request.clientId)
  assert.equal(submitted?.get('client_secret'), request.clientSecret)
  assert.equal(submitted?.get('code'), request.code)
  assert.equal(submitted?.get('code_verifier'), request.codeVerifier)
  assert.equal(submitted?.get('redirect_uri'), request.redirectUri)
  assert.equal(submitted?.get('grant_type'), 'authorization_code')
  assert.deepEqual(tokens, { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' })
})

test('Google OAuth code exchange reports a safe diagnostic for rejected authorization codes', async () => {
  await assert.rejects(
    exchangeGoogleAuthorizationCode(request, async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive response detail' }, { status: 400 })),
    (error: unknown) => {
      assert.ok(error instanceof GoogleOAuthExchangeError)
      assert.equal(error.googleErrorCode, 'invalid_grant')
      assert.match(error.message, /PKCE та redirect URI/)
      assert.doesNotMatch(error.message, /sensitive response detail|synthetic-authorization-code|synthetic-client-secret/)
      return true
    },
  )
})

test('Google OAuth code exchange does not disclose untrusted token endpoint descriptions', async () => {
  await assert.rejects(
    exchangeGoogleAuthorizationCode(request, async () => Response.json({ error: 'invalid_client', error_description: 'synthetic-client-secret leaked here' }, { status: 401 })),
    (error: unknown) => {
      assert.ok(error instanceof GoogleOAuthExchangeError)
      assert.equal(error.googleErrorCode, 'invalid_client')
      assert.doesNotMatch(error.message, /synthetic-client-secret leaked here/)
      return true
    },
  )
})
