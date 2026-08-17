import { AlertCircle, Clock3, Cpu, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useZktecoDeviceStatus } from '@/hooks/useZktecoDeviceStatus'
import { useAuth } from '@/contexts/AuthContext'
import type { ZktecoDeviceState } from '@/services/zktecoStatus'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

export function ZktecoNavbarStatus() {
  const { role } = useAuth()
  const query = useZktecoDeviceStatus({ poll: true })
  const status = query.data?.status ?? 'unknown'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          aria-label={`ZKTeco device ${statusLabel(status)}`}
        >
          <StatusIcon status={status} loading={query.isLoading} className="h-4 w-4" />
          <span className="hidden text-xs font-medium sm:inline">Device</span>
          <span className={cn('text-xs font-medium', statusTextClass(status))}>
            {query.isLoading ? 'Checking' : statusLabel(status)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <DeviceStatusDetails admin={role === 'admin'} />
      </PopoverContent>
    </Popover>
  )
}

export function ZktecoDeviceStatusCard() {
  const query = useZktecoDeviceStatus()
  const status = query.data?.status ?? 'unknown'

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4" />
              ZKTeco Device Status
            </CardTitle>
            <CardDescription>Live status from the Cloudflare Worker</CardDescription>
          </div>
          {query.isLoading ? (
            <Skeleton className="h-6 w-20 rounded-full" />
          ) : (
            <StatusBadge status={status} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <DeviceStatusDetails admin />
      </CardContent>
    </Card>
  )
}

function DeviceStatusDetails({ admin }: { admin: boolean }) {
  const { data, isLoading, isFetching, error, refetch } = useZktecoDeviceStatus()
  const status = data?.status ?? 'unknown'

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="Loading device status">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-8 w-28" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} className="h-5 w-5" />
          <span className="font-semibold">Device {statusLabel(status)}</span>
        </div>
        <StatusBadge status={status} />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Could not refresh the device status. {error.message}</span>
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <p>Last seen</p>
          <p className="font-medium text-foreground">
            {data?.lastSeen ? formatLocalDateTime(data.lastSeen) : 'Not reported'}
          </p>
          {data?.lastSeenAgeSeconds != null && <p>{formatAge(data.lastSeenAgeSeconds)} ago</p>}
        </div>
      </div>

      {admin && data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/20 p-2 text-xs">
          <dt className="text-muted-foreground">Serial</dt>
          <dd className="truncate text-right font-mono">{data.serialNumber}</dd>
          <dt className="text-muted-foreground">Offline after</dt>
          <dd className="text-right">{data.offlineAfterSeconds == null ? 'Not reported' : formatAge(data.offlineAfterSeconds)}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="text-right">Cloudflare Worker</dd>
        </dl>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="w-full"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        {isFetching ? 'Refreshing...' : 'Refresh Status'}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Automatically refreshes every 10 minutes
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: ZktecoDeviceState }) {
  return (
    <Badge
      variant={status === 'unknown' ? 'secondary' : 'outline'}
      className={cn(
        status === 'online' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        status === 'offline' && 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
      )}
    >
      {statusLabel(status)}
    </Badge>
  )
}

function StatusIcon({ status, loading = false, className }: {
  status: ZktecoDeviceState
  loading?: boolean
  className?: string
}) {
  if (loading) return <RefreshCw className={cn(className, 'animate-spin text-muted-foreground')} />
  if (status === 'online') return <Wifi className={cn(className, 'text-emerald-600')} />
  if (status === 'offline') return <WifiOff className={cn(className, 'text-red-600')} />
  return <AlertCircle className={cn(className, 'text-muted-foreground')} />
}

function statusLabel(status: ZktecoDeviceState) {
  return status[0].toUpperCase() + status.slice(1)
}

function statusTextClass(status: ZktecoDeviceState) {
  if (status === 'online') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'offline') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function formatLocalDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} sec`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr`
  return `${Math.round(seconds / 86400)} day${seconds < 172800 ? '' : 's'}`
}
