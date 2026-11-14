export type AutosaveSnapshot = { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }

// Serialize writes and merge pending edits so older requests cannot overwrite newer ones.
export function createAutosaveQueue<T extends object>(save: (patch: T) => Promise<void>, delay = 0) {
  let pending: T | null = null
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let snapshot: AutosaveSnapshot = { status: 'idle' }
  const listeners = new Set<() => void>()
  const publish = (next: AutosaveSnapshot) => {
    snapshot = next
    listeners.forEach(listener => listener())
  }

  const flush = (): Promise<void> => {
    clearTimeout(timer)
    if (running) return running
    if (!pending) return Promise.resolve()
    publish({ status: 'saving' })
    running = (async () => {
      while (pending) {
        const patch = pending
        pending = null
        try {
          await save(patch)
        } catch (error) {
          pending = Object.assign({}, patch, pending)
          publish({ status: 'error', error: error instanceof Error ? error.message : 'Unable to save changes' })
          return
        }
      }
      publish({ status: 'saved' })
    })().finally(() => { running = null })
    return running
  }

  return {
    enqueue(patch: T) {
      pending = { ...pending, ...patch }
      publish({ status: 'saving' })
      clearTimeout(timer)
      if (delay === 0) void flush()
      else timer = setTimeout(() => { void flush() }, delay)
    },
    flush,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
