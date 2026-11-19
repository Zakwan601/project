import { AdminDailyPresence } from './AdminDailyPresence'
import { motion } from 'framer-motion'
import { AlarmClock, CalendarCheck, CheckCircle, Clock, GraduationCap, Users, UserX } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis } from 'recharts'
import { useAdminDashboard } from '@/hooks/useDashboard'
import { useAuth } from '@/contexts/AuthContext'
import { StudentDashboard } from '@/features/dashboard/StudentDashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { formatDisplayDate, splitBangladeshDateTime } from '@/lib/dateTime'

const chartConfig = {
  present: { label: 'Present', color: '#0d9488' },
  absent: { label: 'Absent', color: '#e11d48' },
  late: { label: 'Late', color: '#d99a00' },
  too_late: { label: 'Too late', color: '#9333ea' },
  excused: { label: 'Approved leave', color: '#2563eb' },
} satisfies ChartConfig

export function DashboardPage() {
  const { profile } = useAuth()

  if (profile?.role === 'student') return <StudentDashboard />

  const { data: dashboard, isLoading, error } = useAdminDashboard()
  const stats = dashboard?.stats
  const weekly = dashboard?.weekly

  const weeklyChartData = weekly?.map(day => ({
    date: format(new Date(day.date), 'EEE'),
    present: day.present,
    absent: day.absent,
    late: day.late,
  })) ?? []
  const presentToday = stats?.presentToday ?? 0
  const tooLateToday = stats?.tooLateToday ?? 0
  // The aggregate absence total includes too-late arrivals; split the snapshot into distinct statuses.
  const absentToday = Math.max(0, (stats?.absentToday ?? 0) - tooLateToday)
  const lateToday = stats?.lateToday ?? 0
  const excusedToday = stats?.excusedToday ?? 0
  const today = splitBangladeshDateTime(new Date()).date
  const todayTotal = presentToday + absentToday + lateToday + tooLateToday + excusedToday
  const todayPieData = [
    { status: 'present', count: presentToday, fill: 'var(--color-present)' },
    { status: 'absent', count: absentToday, fill: 'var(--color-absent)' },
    { status: 'late', count: lateToday, fill: 'var(--color-late)' },
    { status: 'too_late', count: tooLateToday, fill: 'var(--color-too_late)' },
    { status: 'excused', count: excusedToday, fill: 'var(--color-excused)' },
  ]

  return (
    <div className="space-y-3 sm:space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="pb-1"
      >
        <p className="text-xs font-medium text-muted-foreground">
          {formatDisplayDate(new Date())}
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Good {getGreeting()}, {profile?.full_name?.split(' ')[0] ?? 'there'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile?.sub_admin_label === 'teacher' ? "Today's attendance for your assigned classes." : "Today's school attendance at a glance."}
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Students" value={error ? '—' : stats?.totalStudents ?? 0} loading={isLoading} to="/students" />
        <SummaryCard icon={GraduationCap} label="Classes" value={error ? '—' : stats?.totalClasses ?? 0} loading={isLoading} to="/classes" />
        <SummaryCard
          icon={CheckCircle}
          label="Attendance rate"
          value={error ? '—' : `${stats?.todayAttendanceRate ?? 0}%`}
          loading={isLoading}
          to={`/attendance?date=${today}`}
        />
        <SummaryCard
          icon={CalendarCheck}
          label="Approved leave"
          value={error ? '—' : excusedToday}
          loading={isLoading}
          to={`/attendance?date=${today}&status=excused`}
        />
      </div>

      <AdminDailyPresence />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Weekly Attendance</CardTitle>
            <CardDescription>One attendance result per student each day</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : error ? (
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
                  <Snapshot icon={CheckCircle} label="Present" value={presentToday} color={chartConfig.present.color} to={`/attendance?date=${today}&status=present`} />
                  <Snapshot icon={UserX} label="Absent" value={absentToday} color={chartConfig.absent.color} to={`/attendance?date=${today}&status=absent`} />
                  <Snapshot icon={Clock} label="Late" value={lateToday} color={chartConfig.late.color} to={`/attendance?date=${today}&status=late`} />
                  <Snapshot icon={AlarmClock} label="Too late" value={tooLateToday} color={chartConfig.too_late.color} to={`/attendance?date=${today}&status=too_late`} />
                  <Snapshot icon={CalendarCheck} label="Approved leave" value={excusedToday} color={chartConfig.excused.color} to={`/attendance?date=${today}&status=excused`} />
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

function SummaryCard({
  icon: Icon,
  label,
  value,
  loading = false,
  to,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  loading?: boolean
  to: string
}) {
  const card = (
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
  return (
    <Link
      to={to}
      className="block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
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
  color,
  to,
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
  to: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4" style={{ color }} />
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </Link>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
