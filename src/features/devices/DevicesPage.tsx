import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Clock3,
  Cpu,
  Database,
  Fingerprint,
  MapPin,
  RefreshCw,
  ScanFace,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { format } from 'date-fns'
import { useDevices, useDeleteDevice, useUpdateDevice } from '@/hooks/useDevices'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Device } from '@/types/database'

export function DevicesPage() {
  const { data: devices, isLoading, error } = useDevices()
  const updateDevice = useUpdateDevice()
  const deleteDevice = useDeleteDevice()
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleSync = async (id: string) => {
    await updateDevice.mutateAsync({
      id,
      updates: { last_sync_at: new Date().toISOString() },
    })
  }

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <PageHeader
        title="Devices"
        description="Biometric devices registered in the system"
      />

      {devices?.length === 0 ? (
        <EmptyState
          title="No devices found"
          description="Devices will appear here after they are added to the database."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {devices?.map((device, index) => (
            <DeviceCard
              key={device.id}
              device={device}
              index={index}
              syncing={updateDevice.isPending}
              onSync={() => handleSync(device.id)}
              onDelete={() => setDeleteId(device.id)}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Device</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the device and all associated logs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteId) deleteDevice.mutate(deleteId)
                setDeleteId(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DeviceCard({
  device,
  index,
  syncing,
  onSync,
  onDelete,
}: {
  device: Device
  index: number
  syncing: boolean
  onSync: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="h-full overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                device.is_online
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-base">
                  {device.alias || device.name}
                </CardTitle>
                <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <span>{display(device.model)}</span>
                  <span aria-hidden="true">•</span>
                  <span className="font-mono">{device.sn}</span>
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={device.is_online ? 'default' : 'secondary'}
                className={device.is_online ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
              >
                {device.is_online ? <Wifi /> : <WifiOff />}
                {device.is_online ? 'Online' : 'Offline'}
              </Badge>
              <Badge variant={device.is_active ? 'outline' : 'secondary'}>
                {device.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 p-5">
          <section>
            <SectionTitle icon={<Cpu />} title="Identification" />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Database ID" value={device.id} mono />
              <Detail label="Serial (sn)" value={device.sn} mono />
              <Detail label="Device serial" value={device.device_serial} mono />
              <Detail label="Name" value={device.name} />
              <Detail label="Alias" value={device.alias} />
              <Detail label="Model" value={device.model} />
            </div>
          </section>

          <section>
            <SectionTitle icon={<Wifi />} title="Connection and software" />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="IP address" value={device.ip_address} mono />
              <Detail label="Port" value={stringValue(device.port)} mono />
              <Detail label="Location" value={device.location} icon={<MapPin />} />
              <Detail label="Area" value={device.area} />
              <Detail label="Firmware version" value={device.firmware_version} />
              <Detail label="Push version" value={device.push_version} />
              <Detail label="Push time" value={device.push_time} />
              <Detail label="Transfer interval" value={device.transfer_interval} />
              <Detail label="Attendance status" value={device.attendance_status} />
              <Detail label="Device state" value={device.device_state} />
            </div>
          </section>

          <section>
            <SectionTitle icon={<Database />} title="Stored records" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Metric icon={<Users />} label="Users" value={device.user_count} />
              <Metric icon={<Fingerprint />} label="Fingerprints" value={device.fingerprint_count} />
              <Metric icon={<ScanFace />} label="Faces" value={device.face_count} />
              <Metric icon={<Fingerprint />} label="Palms" value={device.palm_count} />
              <Metric icon={<Activity />} label="Transactions" value={device.transaction_count} />
            </div>
          </section>

          <section>
            <SectionTitle icon={<Clock3 />} title="Timestamps" />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Last activity" value={dateValue(device.last_activity)} />
              <Detail label="Last sync" value={dateValue(device.last_sync_at)} />
              <Detail label="Synced at" value={dateValue(device.synced_at)} />
              <Detail label="Created at" value={dateValue(device.created_at)} />
              <Detail label="Updated at" value={dateValue(device.updated_at)} />
            </div>
          </section>

          <section>
            <SectionTitle icon={<Activity />} title="Boolean status" />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="is_online" value={device.is_online ? 'true' : 'false'} mono />
              <Detail label="is_active" value={device.is_active ? 'true' : 'false'} mono />
            </div>
          </section>

          <div className="flex gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={onSync}
              disabled={syncing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncing ? 'animate-spin' : ''}`} />
              Update sync time
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
              aria-label={`Remove ${device.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <details className="rounded-md border bg-muted/20 text-xs">
            <summary className="cursor-pointer px-3 py-2 font-medium text-muted-foreground">
              Raw data
            </summary>
            <pre className="max-h-72 overflow-auto border-t p-3 text-[11px] leading-relaxed">
              {device.raw_data ? JSON.stringify(device.raw_data, null, 2) : 'null'}
            </pre>
          </details>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
      {icon}
      {title}
    </h3>
  )
}

function Detail({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1 truncate text-sm ${mono ? 'font-mono' : ''}`}>
        {icon}
        {display(value)}
      </p>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</div>
      <p className="text-lg font-semibold leading-none">{value.toLocaleString()}</p>
      <p className="mt-1.5 truncate text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}

function display(value: string | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : value
}

function stringValue(value: number | null) {
  return value === null ? null : String(value)
}

function dateValue(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : format(date, 'MMM d, yyyy, HH:mm:ss')
}
