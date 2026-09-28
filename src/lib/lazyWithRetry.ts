import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'axentra:chunk-recovery'
const RETRY_DELAYS = [250, 750] as const

const wait = (milliseconds: number) =>
  new Promise(resolve => window.setTimeout(resolve, milliseconds))

function recoverFromStaleDeployment(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const isChunkFailure = /dynamically imported module|failed to fetch|importing a module script|load module/i.test(message)
  if (!isChunkFailure || !navigator.onLine) throw error

  const previousRecovery = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  if (Date.now() - previousRecovery < 30_000) throw error

  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  window.location.reload()
  return new Promise<never>(() => undefined)
}

export function lazyWithRetry<TModule, TComponent extends ComponentType<unknown>>(
  importer: () => Promise<TModule>,
  select: (module: TModule) => TComponent,
) {
  return lazy(async () => {
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        const module = await importer()
        return { default: select(module) }
      } catch (error) {
        lastError = error
        if (attempt < RETRY_DELAYS.length) await wait(RETRY_DELAYS[attempt])
      }
    }

    return recoverFromStaleDeployment(lastError)
  })
}

