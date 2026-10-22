export async function readRecoveryKeyHidden(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Для безпечного введення ключа запустіть команду в інтерактивному терміналі.')
  return new Promise((resolveKey, rejectKey) => {
    const input = process.stdin
    const output = process.stdout
    let value = ''
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { cleanup(); rejectKey(new Error('Операцію скасовано.')); return }
        if (character === '\r' || character === '\n') { output.write('\n'); cleanup(); resolveKey(value); return }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue }
        if (character >= ' ' && character <= '~') value += character
      }
    }
    const cleanup = () => { input.off('data', onData); input.setRawMode(false); input.pause() }
    output.write('Введіть офлайн-ключ відновлення (введення приховано): ')
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

