import { motion } from 'framer-motion'
import { CheckCircle, UserX, Clock, TrendingUp, AlarmClock, Banknote, MessageSquareWarning } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentDashboardStats, useStudentWeeklyAttendance } from '@/hooks/useStudentDashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, CartesianGrid } from 'recharts'
import type { ChartConfig } from '@/components/ui/chart'
import { StudentNotices } from '@/components/dashboard/StudentNotices'
import { formatDisplayDate } from '@/lib/dateTime'
import { calculateAttendanceFine, formatFine } from '@/lib/attendanceFine'
const chartConfig = {
  present: { label: 'Present', color: 'var(--chart-2)' },
  absent: { label: 'Absent', color: 'var(--chart-1)' },
  late: { label: 'Late', color: 'var(--chart-4)' },
} satisfies ChartConfig

function StatCard({ title, value, description, icon: Icon, delay = 0, colorClass = 'bg-primary/10 text-primary', accentClass = 'bg-primary', loading = false }: {
  title: string
  value: string | number
  description?: string
  icon: React.ElementType
  delay?: number
  colorClass?: string
  accentClass?: string
  loading?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="h-full"
    >
      <Card className="group relative h-full overflow-hidden py-0 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
        <div className={`absolute inset-x-0 top-0 h-1 ${accentClass}`} />
        <CardContent className="p-3 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{title}</p>
              {loading
                ? <Skeleton className="h-8 w-16 sm:h-9" />
                : <p className="text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>}
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            <div className={`flex h-6 w-6 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${colorClass}`}>
              <Icon className="h-6 w-6" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function StudentDashboard() {
  const { profile, student } = useAuth()
  const studentId = student?.id
  const { data: stats, isLoading: statsLoading, error } = useStudentDashboardStats(studentId)
  const { data: weekly, isLoading: weeklyLoading, error: weeklyError } = useStudentWeeklyAttendance(studentId)
  const dashboardLoading = statsLoading
  const fine = calculateAttendanceFine(
    stats?.fineRecordedAbsences ?? 0,
    stats?.fineLateDays ?? 0,
    Number(stats?.finePerAbsentDay ?? 0),
    stats?.examMissedCount ?? 0,
    Number(stats?.examMissedFineAmount ?? 0),
  )

  const today = format(new Date(), 'yyyy-MM-dd')
  const weeklyChartData = weekly?.map(d => ({
    date: d.date === today ? 'Today' : format(new Date(d.date), 'EEE'),
    present: d.present,
    absent: d.absent,
    late: d.late,
  })) ?? []

  return (
    <div className="space-y-3 sm:space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="pb-1"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {formatDisplayDate(new Date())}
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Good {getGreeting()}, {student?.first_name ?? profile?.full_name?.split(' ')[0] ?? 'there'}
        </h2>
      </motion.div>

      {/* Personal attendance stats */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <StatCard
          title="Attendance"
          value={`${stats?.attendanceRate ?? 0}%`}
          icon={TrendingUp}
          delay={0}
          colorClass="bg-orange-500/10 text-orange-600 dark:text-orange-400"
          accentClass=""
          loading={dashboardLoading}
        />
        <StatCard
          title="Present"
          value={stats?.presentCount ?? 0}
          icon={CheckCircle}
          delay={0.05}
          colorClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          accentClass=""
          loading={dashboardLoading}
        />
        <StatCard
          title="Absent"
          value={stats?.absentCount ?? 0}
          description={dashboardLoading ? undefined : `${fine.fineableAbsences} attendance · ${fine.examMissedCount} exam missed · ${formatFine(fine.totalFine)}`}
          icon={UserX}
          delay={0.1}
          colorClass="bg-red-500/10 text-red-600 dark:text-red-400"
          accentClass=""
          loading={dashboardLoading}
        />
        <StatCard
          title="Late"
          value={stats?.lateCount ?? 0}
          description={dashboardLoading ? undefined : `+${fine.latePenaltyAbsences} fineable absence${fine.latePenaltyAbsences === 1 ? '' : 's'}`}
          icon={Clock}
          delay={0.15}
          colorClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          accentClass=""
          loading={dashboardLoading}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load your attendance summary.
        </p>
      )}

      <StudentNotices />

      {/* Weekly attendance chart and attendance instructions */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="grid items-stretch gap-3 sm:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"
      >
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Weekly Attendance</CardTitle>
            <CardDescription>Last 7 days attendance overview</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyLoading ? (
              <StudentChartSkeleton />
            ) : weeklyError ? (
              <p className="py-12 text-center text-sm text-destructive">Could not load weekly attendance.</p>
            ) : weeklyChartData.length > 0 && weeklyChartData.some(d => d.present + d.absent + d.late > 0) ? (
              <ChartContainer config={chartConfig} className="h-[180px] w-full aspect-auto sm:h-[260px]">
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
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                No attendance data for the past week
              </div>
            )}
          </CardContent>
        </Card>
        <AttendanceInstructions
          finePerAbsentDay={fine.finePerAbsentDay}
          examMissedFine={fine.examMissedFineAmount}
          loading={dashboardLoading}
          error={Boolean(error)}
        />
      </motion.div>

    </div>
  )
}

function AttendanceInstructions({
  finePerAbsentDay,
  examMissedFine,
  loading,
  error,
}: {
  finePerAbsentDay: number
  examMissedFine: number
  loading: boolean
  error: boolean
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AlarmClock className="h-5 w-5" /> Attendance Instructions</CardTitle>
        <CardDescription>Arrival status and fine rules</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          <InstructionRow label="Present" value="Arrival by 8:20 AM" tone="text-emerald-600 dark:text-emerald-400" />
          <InstructionRow label="Late" value="After 8:20 AM through 9:00 AM" tone="text-amber-600 dark:text-amber-400" />
          <InstructionRow label="Too late" value="After 9:00 AM; counted as absent" tone="text-red-600 dark:text-red-400" />
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-2 font-semibold"><Banknote className="h-4 w-4" /> Fine rules</p>
          {loading ? <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/5" /></div>
            : error ? <p className="text-xs text-destructive">Fine values are currently unavailable.</p>
              : <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>Absent or too late: <span className="font-medium text-foreground">{formatFine(finePerAbsentDay)}</span></li>
                <li>Every 2 late days add 1 absence fine: <span className="font-medium text-foreground">{formatFine(finePerAbsentDay)}</span></li>
                <li>Missing an exam: <span className="font-medium text-foreground">{formatFine(examMissedFine)}</span></li>
              </ul>}
        </div>

        <p className="border-t pt-4 text-muted-foreground">
          In case of any issue, submit it at {' '}
          <Link to="/report-issue" className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
            <MessageSquareWarning className="h-4 w-4" /> Report an Issue
          </Link>.
        </p>
      </CardContent>
    </Card>
  )
}

function InstructionRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className={`font-semibold ${tone}`}>{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  )
}

function StudentChartSkeleton() {
  return (
    <div className="flex h-[180px] items-end gap-3 px-2 sm:h-[260px]">
      {[55, 80, 45, 70, 62, 88, 50].map((height, index) => (
        <Skeleton key={index} className="flex-1" style={{ height: `${height}%` }} />
      ))}
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
