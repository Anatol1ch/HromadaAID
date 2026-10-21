export class HttpClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpClientError'
  }
}

export type JsonValidator<T> = (value: unknown) => value is T

export class HttpClient {
  constructor(private readonly baseUrl: URL, private readonly timeoutMs = 5_000) {}

  async getJson<T>(path: string, validator?: JsonValidator<T>): Promise<T> {
    if (!path.startsWith('/')) throw new HttpClientError('Шлях HTTP API має починатися з «/».')

    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new HttpClientError('Сервер не відповів у встановлений час.')
      }
      throw new HttpClientError('Не вдалося підключитися до сервера.')
    }

    if (!response.ok) throw new HttpClientError(`Сервер повернув помилку HTTP ${response.status}.`)

    let body: unknown
    try { body = await response.json() }
    catch { throw new HttpClientError('Сервер повернув некоректну JSON-відповідь.') }
    if (validator && !validator(body)) throw new HttpClientError('Сервер повернув відповідь у непідтримуваному форматі.')
    return body as T
  }
}
