export class HttpClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'HttpClientError'
  }
}

export type JsonValidator<T> = (value: unknown) => value is T
type RequestOptions = { authorize?: boolean; accessToken?: string }
type HttpClientOptions = { getAccessToken?: () => string | undefined; onUnauthorized?: (token: string | undefined) => void }

/** Main-process HTTP transport. Tokens are obtained only through its private callback. */
export class HttpClient {
  constructor(private readonly baseUrl: URL, private readonly timeoutMs = 5_000, private readonly options: HttpClientOptions = {}) {}

  async getJson<T>(path: string, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('GET', path, undefined, validator, options)
  }

  async postJson<T>(path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('POST', path, body, validator, options)
  }

  async putJson<T>(path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('PUT', path, body, validator, options)
  }

  async deleteJson<T>(path: string, body?: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('DELETE', path, body, validator, options)
  }

  async postNoContent(path: string, body?: unknown, options?: RequestOptions): Promise<void> {
    const { response, body: responseBody } = await this.request('POST', path, body, options)
    if (!response.ok) throw this.responseError(response.status, responseBody)
  }

  private async requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    const { response, body: responseBody } = await this.request(method, path, body, options)
    if (!response.ok) {
      // Write endpoints deliberately return their typed validation/conflict result with 4xx status.
      if (validator && validator(responseBody)) return responseBody
      throw this.responseError(response.status, responseBody)
    }
    if (validator && !validator(responseBody)) throw new HttpClientError('Сервер повернув відповідь у непідтримуваному форматі.')
    return responseBody as T
  }

  private async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, options?: RequestOptions): Promise<{ response: Response; body: unknown }> {
    if (!path.startsWith('/')) throw new HttpClientError('Шлях HTTP API має починатися з «/».')
    const authorize = options?.authorize !== false
    const token = authorize ? (options?.accessToken ?? this.options.getAccessToken?.()) : undefined
    if (authorize && !token) throw new HttpClientError('Потрібна чинна сесія.', 401)
    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new HttpClientError('Сервер не відповів у встановлений час.')
      throw new HttpClientError('Не вдалося підключитися до сервера.')
    }

    if (authorize && response.status === 401) this.options.onUnauthorized?.(token)
    this.checkRequestSession(authorize, token, options)
    if (response.status === 204) return { response, body: undefined }
    let responseBody: unknown
    try { responseBody = await response.json() }
    catch { throw new HttpClientError('Сервер повернув некоректну JSON-відповідь.') }
    this.checkRequestSession(authorize, token, options)
    return { response, body: responseBody }
  }

  private checkRequestSession(authorize: boolean, token: string | undefined, options?: RequestOptions): void {
    // A response belongs to the session that issued it, never to a later login.
    if (authorize && options?.accessToken === undefined && token !== this.options.getAccessToken?.()) {
      throw new HttpClientError('Запит попередньої сесії скасовано.', 401)
    }
  }

  private responseError(status: number, responseBody: unknown): HttpClientError {
    const message = responseBody && typeof responseBody === 'object' && 'message' in responseBody && typeof responseBody.message === 'string'
      ? responseBody.message
      : `Сервер повернув помилку HTTP ${status}.`
    return new HttpClientError(message, status)
  }
}
