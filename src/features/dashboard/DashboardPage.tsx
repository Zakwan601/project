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
import { LoadingState, ErrorState } from '@/components/shared/PageHeader'
import { StudentReportNotifications } from '@/components/reports/StudentReportNotifications'
import type { SyncServiceHealth, SyncServiceStatus } from '@/types/database'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'

const chartConfig = {
  present: { label: 'Present', color: 'var(--chart-2)' },
  absent: { label: 'Absent', color: 'var(--chart-5)' },
  late: { label: 'Late', color: 'var(--chart-4)' },
} satisfies ChartConfig

export function DashboardPage() {
  const { profile } = useAuth()

  if (profile?.role === 'student') return <StudentDashboard />

  const { data: stats, isLoading, error } = useDashboardStats()
  const { data: weekly } = useWeeklyAttendance()
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const {
    data: syncService,
    isLoading: syncServiceLoading,
    error: syncServiceError,
  } = useSyncServiceHealth()

  if (isLoading) return <LoadingState message="Loading dashboard..." />
  if (error) return <ErrorState message={(error as Error).message} />

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
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 sm:p-8"
      >
        <p className="text-xs font-medium text-muted-foreground">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Good {getGreeting()}, {profile?.full_name?.split(' ')[0] ?? 'there'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Today&apos;s school attendance at a glance.
        </p>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Users} label="Students" value={stats?.totalStudents ?? 0} />
        <SummaryCard icon={GraduationCap} label="Classes" value={stats?.totalClasses ?? 0} />
        <SummaryCard
          icon={CheckCircle}
          label="Attendance rate"
          value={`${stats?.todayAttendanceRate ?? 0}%`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Machine Status
          </CardTitle>
          <CardDescription>
            Live biometric machine and desktop sync service status, refreshed every minute
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SyncServiceStatusCard
              health={syncService}
              isLoading={syncServiceLoading}
              hasError={Boolean(syncServiceError)}
            />

            {devicesLoading ? (
              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                Checking machine status...
              </div>
            ) : devices && devices.length > 0 ? (
              devices.map(device => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4"
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

      <StudentReportNotifications />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Weekly Attendance</CardTitle>
            <CardDescription>One attendance result per student each day</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyChartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[260px] w-full aspect-auto">
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
            {todayTotal > 0 ? (
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
  const isRunning = health?.is_running === true

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4">
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
}: {
  icon: React.ElementType
  label: string
  value: string | number
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  )
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
