import { motion } from 'framer-motion'
import { Activity, CheckCircle, Clock, Cpu, GraduationCap, Users, UserX, Wifi, WifiOff } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis } from 'recharts'
import { useDashboardStats, useSyncServiceHealth, useWeeklyAttendance } from '@/hooks/useDashboard'
import { useDevices } from '@/hooks/useDevices'
import { useAuth } from '@/contexts/AuthContext'
import { StudentDashboard } from '@/features/dashboard/StudentDashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { SyncServiceHealth, SyncServiceStatus } from '@/types/database'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { formatDisplayDate } from '@/lib/dateTime'

const chartConfig = {
  present: { label: 'Present', color: 'var(--chart-2)' },
  absent: { label: 'Absent', color: 'var(--chart-5)' },
  late: { label: 'Late', color: 'var(--chart-4)' },
} satisfies ChartConfig

export function DashboardPage() {
  const { profile } = useAuth()

  if (profile?.role === 'student') return <StudentDashboard />

  const { data: stats, isLoading, error } = useDashboardStats()
  const { data: weekly, isLoading: weeklyLoading, error: weeklyError } = useWeeklyAttendance()
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const {
    data: syncService,
    isLoading: syncServiceLoading,
    error: syncServiceError,
  } = useSyncServiceHealth()

  const weeklyChartData = weekly?.map(day => ({
    date: format(new Date(day.date), 'EEE'),
    present: day.present,
    absent: day.absent,
    late: day.late,
  })) ?? []
  const presentToday = stats?.presentToday ?? 0
  const absentToday = stats?.absentToday ?? 0
  const lateToday = stats?.lateToday ?? 0
  const todayTotal = presentToday + absentToday + lateToday
  const todayPieData = [
    { status: 'present', count: presentToday, fill: 'var(--color-present)' },
    { status: 'absent', count: absentToday, fill: 'var(--color-absent)' },
    { status: 'late', count: lateToday, fill: 'var(--color-late)' },
  ]

  return (
    <div className="space-y-3 sm:space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-4 sm:p-8"
      >
        <p className="text-xs font-medium text-muted-foreground">
          {formatDisplayDate(new Date())}
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Good {getGreeting()}, {profile?.full_name?.split(' ')[0] ?? 'there'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Today&apos;s school attendance at a glance.
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Students" value={error ? '—' : stats?.totalStudents ?? 0} loading={isLoading} />
        <SummaryCard icon={GraduationCap} label="Classes" value={error ? '—' : stats?.totalClasses ?? 0} loading={isLoading} />
        <SummaryCard
          icon={CheckCircle}
          label="Attendance rate"
          value={error ? '—' : `${stats?.todayAttendanceRate ?? 0}%`}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Hardware Status
          </CardTitle>

        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SyncServiceStatusCard
              health={syncService}
              isLoading={syncServiceLoading}
              hasError={Boolean(syncServiceError)}
            />

            {devicesLoading ? (
              <>
                <HardwareCardSkeleton />
                <HardwareCardSkeleton />
              </>
            ) : devices && devices.length > 0 ? (
              devices.map(device => (
                <div
                  key={device.id}
                className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3 sm:gap-4 sm:p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`rounded-lg p-2.5 ${
                      device.is_online
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {device.is_online
                        ? <Wifi className="h-5 w-5" />
                        : <WifiOff className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{device.alias || device.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{device.sn}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge
                      variant={device.is_online ? 'default' : 'secondary'}
                      className={device.is_online ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
                    >
                      {device.is_online ? 'Online' : 'Offline'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {device.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                No biometric machine is registered.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Weekly Attendance</CardTitle>
            <CardDescription>One attendance result per student each day</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyLoading ? (
              <ChartSkeleton />
            ) : weeklyError ? (
              <SectionError message="Could not load weekly attendance." />
            ) : weeklyChartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full aspect-auto sm:h-[260px]">
                <BarChart accessibilityLayer data={weeklyChartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="present" fill="var(--color-present)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" fill="var(--color-absent)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="late" fill="var(--color-late)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No attendance data for the past week
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Today&apos;s Snapshot</CardTitle>
            <CardDescription>Daily biometric attendance</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton compact />
            ) : error ? (
              <SectionError message="Could not load today's attendance." />
            ) : todayTotal > 0 ? (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <ChartContainer config={chartConfig} className="aspect-square h-[180px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie data={todayPieData} dataKey="count" nameKey="status" innerRadius={52} outerRadius={78}>
                      <Label
                        content={({ viewBox }) => viewBox && 'cx' in viewBox && 'cy' in viewBox ? (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan className="fill-foreground text-2xl font-bold">{todayTotal}</tspan>
                          </text>
                        ) : null}
                      />
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="w-full space-y-3">
                  <Snapshot icon={CheckCircle} label="Present" value={presentToday} className="text-emerald-600" />
                  <Snapshot icon={UserX} label="Absent" value={absentToday} className="text-red-600" />
                  <Snapshot icon={Clock} label="Late" value={lateToday} className="text-amber-600" />
                </div>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No attendance synchronized today
              </p>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  )
}

function SyncServiceStatusCard({
  health,
  isLoading,
  hasError,
}: {
  health: SyncServiceHealth | null | undefined
  isLoading: boolean
  hasError: boolean
}) {
  if (isLoading) return <HardwareCardSkeleton />

  const isRunning = health?.is_running === true

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3 sm:gap-4 sm:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`rounded-lg p-2.5 ${
          isRunning
            ? 'bg-emerald-500/10 text-emerald-600'
            : 'bg-muted text-muted-foreground'
        }`}>
          <Activity className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Desktop Sync Service</p>
          <p className="truncate text-xs text-muted-foreground">
            {syncServiceDetail(health, isLoading, hasError)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge
          variant={isRunning ? 'default' : 'secondary'}
          className={isRunning ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
        >
          {isLoading ? 'Checking' : hasError || !health ? 'Unavailable' : isRunning ? 'Running' : 'Stopped'}
        </Badge>
        <span className={`text-[11px] ${syncStatusClass(health?.last_sync_status)}`}>
          {health ? `Sync: ${health.last_sync_status}` : 'Sync: unavailable'}
        </span>
      </div>
    </div>
  )
}

function syncServiceDetail(
  health: SyncServiceHealth | null | undefined,
  isLoading: boolean,
  hasError: boolean,
) {
  if (isLoading) return 'Checking service heartbeat...'
  if (hasError) return 'Could not load service status'
  if (!health) return 'No service heartbeat has been recorded'
  if (!health.last_sync_at) return 'No completed sync yet'

  return `Last sync ${formatDistanceToNow(new Date(health.last_sync_at), { addSuffix: true })}`
}

function syncStatusClass(status?: SyncServiceStatus) {
  if (status === 'success') return 'text-emerald-600'
  if (status === 'failed') return 'text-red-600'
  if (status === 'running') return 'text-amber-600'
  return 'text-muted-foreground'
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  loading = false,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  loading?: boolean
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3 sm:p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          {loading
            ? <Skeleton className="mt-1 h-7 w-16" />
            : <p className="mt-0.5 text-xl font-bold sm:mt-1 sm:text-2xl">{value}</p>}
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary sm:rounded-xl sm:p-3">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  )
}

function HardwareCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  )
}

function ChartSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-end gap-3 px-2 ${compact ? 'h-[180px]' : 'h-[200px] sm:h-[260px]'}`}>
      {[55, 80, 45, 70, 62, 88, 50].map((height, index) => (
        <Skeleton key={index} className="flex-1" style={{ height: `${height}%` }} />
      ))}
    </div>
  )
}

function SectionError({ message }: { message: string }) {
  return <p className="py-12 text-center text-sm text-destructive">{message}</p>
}

function Snapshot({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType
  label: string
  value: number
  className: string
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className={`h-4 w-4 ${className}`} />
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
