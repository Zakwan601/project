import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createAutosaveQueue } from '@/lib/autosave'

export function useAutosave<T extends object>(save: (patch: T) => Promise<void>, delay = 0) {
  const queue = useMemo(() => createAutosaveQueue(save, delay), [save, delay])
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)

  useEffect(() => {
    const flush = () => { void queue.flush() }
    window.addEventListener('online', flush)
    return () => {
      window.removeEventListener('online', flush)
      flush()
    }
  }, [queue])

  return { ...snapshot, enqueue: queue.enqueue, flush: queue.flush }
}
