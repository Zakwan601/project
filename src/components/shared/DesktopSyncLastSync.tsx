import { Clock3 } from 'lucide-react'
import { useSyncServiceHealth } from '@/hooks/useDashboard'
import { cn } from '@/lib/utils'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { Skeleton } from '@/components/ui/skeleton'

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
      {isLoading ? (
        <Skeleton className="h-4 w-36" />
      ) : lastSyncAt ? (
        <time dateTime={lastSyncAt} className="font-medium text-foreground">
          {formatDisplayDateTime(lastSyncAt)}
        </time>
      ) : (
        <span className="font-medium text-foreground">
          {isLoading ? 'Loading…' : 'No completed sync yet'}
        </span>
      )}
    </div>
  )
}
