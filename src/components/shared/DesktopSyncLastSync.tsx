import { Clock3 } from 'lucide-react'
import { format } from 'date-fns'
import { useSyncServiceHealth } from '@/hooks/useDashboard'
import { cn } from '@/lib/utils'

export function DesktopSyncLastSync({
  className,
  label = 'Desktop Sync Service last sync',
}: {
  className?: string
  label?: string
}) {
  const { data: syncService, isLoading } = useSyncServiceHealth()
  const lastSyncAt = syncService?.last_sync_at

  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <Clock3 className="h-3.5 w-3.5 shrink-0" />
      <span>{label}:</span>
      {lastSyncAt ? (
        <time dateTime={lastSyncAt} className="font-medium text-foreground">
          {format(new Date(lastSyncAt), 'MMM d, yyyy, h:mm:ss a')}
        </time>
      ) : (
        <span className="font-medium text-foreground">
          {isLoading ? 'Loading…' : 'No completed sync yet'}
        </span>
      )}
    </div>
  )
}
