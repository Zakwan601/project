import { motion } from 'framer-motion'
import { CheckCircle, UserX, Clock, TrendingUp, GraduationCap, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentDashboardStats, useStudentIdentity, useStudentWeeklyAttendance } from '@/hooks/useStudentDashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingState, ErrorState } from '@/components/shared/PageHeader'
import { DesktopSyncLastSync } from '@/components/shared/DesktopSyncLastSync'
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, CartesianGrid } from 'recharts'
import type { ChartConfig } from '@/components/ui/chart'
const chartConfig = {
  present: { label: 'Present', color: 'var(--chart-2)' },
  absent: { label: 'Absent', color: 'var(--chart-5)' },
  late: { label: 'Late', color: 'var(--chart-4)' },
} satisfies ChartConfig

function StatCard({ title, value, description, icon: Icon, delay = 0, colorClass = 'bg-primary/10 text-primary', accentClass = 'bg-primary' }: {
  title: string
  value: string | number
  description?: string
  icon: React.ElementType
  delay?: number
  colorClass?: string
  accentClass?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <Card className="group relative overflow-hidden py-0 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
        <div className={`absolute inset-x-0 top-0 h-1 ${accentClass}`} />
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-3xl font-bold tracking-tight">{value}</p>
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
  const { profile } = useAuth()
  const { data: student, isLoading: idLoading } = useStudentIdentity()
  const studentId = student?.id
  const { data: stats, isLoading: statsLoading, error } = useStudentDashboardStats(studentId)
  const { data: weekly } = useStudentWeeklyAttendance(studentId)

  const today = format(new Date(), 'yyyy-MM-dd')
  const weeklyChartData = weekly?.map(d => ({
    date: d.date === today ? 'Today' : format(new Date(d.date), 'EEE'),
    present: d.present,
    absent: d.absent,
    late: d.late,
  })) ?? []

  if (idLoading || statsLoading) return <LoadingState message="Loading your dashboard..." />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-purple-500/5 blur-3xl" />
        <div className="relative flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </div>
        <h2 className="relative mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Good {getGreeting()}, {profile?.full_name?.split(' ')[0] ?? 'there'}
        </h2>
        <DesktopSyncLastSync className="relative mt-3" label="Attendance last updated" />
        {stats?.className && (
          <div className="relative mt-4 inline-flex items-center gap-3 rounded-xl border bg-background/60 px-4 py-2.5 backdrop-blur">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <GraduationCap className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">{stats.className}</p>
              <p className="text-xs text-muted-foreground">
                Grade {stats.classGrade}-{stats.classSection}
              </p>
            </div>
          </div>
        )}
      </motion.div>

      {/* Personal attendance stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Attendance"
          value={`${stats?.attendanceRate ?? 0}%`}
          icon={TrendingUp}
          delay={0}
          colorClass="bg-orange-500/10 text-orange-600 dark:text-orange-400"
          accentClass=""
        />
        <StatCard
          title="Present"
          value={stats?.presentCount ?? 0}
          icon={CheckCircle}
          delay={0.05}
          colorClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          accentClass=""
        />
        <StatCard
          title="Absent"
          value={stats?.absentCount ?? 0}
          icon={UserX}
          delay={0.1}
          colorClass="bg-red-500/10 text-red-600 dark:text-red-400"
          accentClass=""
        />
        <StatCard
          title="Late"
          value={stats?.lateCount ?? 0}
          icon={Clock}
          delay={0.15}
          colorClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          accentClass=""
        />
      </div>

      {/* Weekly attendance chart */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>My Weekly Attendance</CardTitle>
            <CardDescription>Last 7 days attendance overview</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyChartData.length > 0 && weeklyChartData.some(d => d.present + d.absent + d.late > 0) ? (
              <ChartContainer config={chartConfig} className="h-[220px] w-full sm:h-[260px] aspect-auto">
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
      </motion.div>

    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
