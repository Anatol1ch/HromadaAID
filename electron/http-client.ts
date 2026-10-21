export class HttpClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'HttpClientError'
  }
}

export type JsonValidator<T> = (value: unknown) => value is T

export class HttpClient {
  constructor(private readonly baseUrl: URL, private readonly timeoutMs = 5_000) {}

  async getJson<T>(path: string, validator?: JsonValidator<T>): Promise<T> {
    return this.requestJson('GET', path, undefined, validator)
  }

  async postJson<T>(path: string, body: unknown, validator?: JsonValidator<T>): Promise<T> {
    return this.requestJson('POST', path, body, validator)
  }

  async putJson<T>(path: string, body: unknown, validator?: JsonValidator<T>): Promise<T> { return this.requestJson('PUT', path, body, validator) }
  async deleteJson<T>(path: string, validator?: JsonValidator<T>): Promise<T> { return this.requestJson('DELETE', path, undefined, validator) }

  private async requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, validator?: JsonValidator<T>): Promise<T> {
    if (!path.startsWith('/')) throw new HttpClientError('Шлях HTTP API має починатися з «/».')

    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new HttpClientError('Сервер не відповів у встановлений час.')
      }
      throw new HttpClientError('Не вдалося підключитися до сервера.')
    }

    let responseBody: unknown
    try { responseBody = await response.json() }
    catch { throw new HttpClientError('Сервер повернув некоректну JSON-відповідь.') }
    if (!response.ok) {
      // Write endpoints deliberately return their typed validation/conflict
      // result with 4xx status. Preserve it for existing renderer handling.
      if (validator && validator(responseBody)) return responseBody
      const message = responseBody && typeof responseBody === 'object' && 'message' in responseBody && typeof responseBody.message === 'string' ? responseBody.message : `Сервер повернув помилку HTTP ${response.status}.`
      throw new HttpClientError(message, response.status)
    }
    if (validator && !validator(responseBody)) throw new HttpClientError('Сервер повернув відповідь у непідтримуваному форматі.')
    return responseBody as T
  }
}
