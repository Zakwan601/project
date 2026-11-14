import type { AutosaveSnapshot } from '@/lib/autosave'

export function AutosaveStatus({ status, error, invalid = false }: AutosaveSnapshot & { invalid?: boolean }) {
  return (
    <p role="status" aria-live="polite" className={`text-xs ${status === 'error' || invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
      {invalid ? 'Check the highlighted fields. Valid changes save automatically.'
        : status === 'saving' ? 'Saving…'
          : status === 'error' ? `Not saved. ${error}. Edit again to retry; reconnecting also retries.`
            : status === 'saved' ? 'Saved automatically' : 'Changes save automatically'}
    </p>
  )
}
