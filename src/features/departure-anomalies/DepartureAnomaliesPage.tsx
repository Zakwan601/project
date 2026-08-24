import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Clock3, Search, ShieldAlert, TrendingDown, UserX, Users } from 'lucide-react'
import { useClasses } from '@/hooks/useClasses'
import { useAnalyzeDepartureAnomalies, useSavedDepartureAnalysis } from '@/hooks/useDepartureAnomalies'
import type {
  DepartureAnalysisResponse,
  DepartureAnomalyCategory,
  DepartureRiskLevel,
  FlaggedDepartureStudent,
} from '@/services/departureAnomalies'
import { formatDisplayDate, formatTimeWithPeriod } from '@/lib/dateTime'
import { PageHeader } from '@/components/shared/PageHeader'
import { DateFilter } from '@/components/shared/DateFilter'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/contexts/AuthContext'

const categoryLabels: Record<DepartureAnomalyCategory, string> = {
  missing_departure: 'No departure scan',
  significantly_early: 'Early departure',
  statistical_outlier: 'Class outlier',
}

export function DepartureAnomaliesPage() {
  const { can } = useAuth()
  const canWriteDepartureAnalysis = can('departure_anomalies', 'write')
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const analysis = useAnalyzeDepartureAnomalies()
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [departureTime, setDepartureTime] = useState('')
  const savedAnalysis = useSavedDepartureAnalysis(classId, date)
  const savedDepartureTime = savedAnalysis.data?.configuration.departure_time.slice(0, 5) ?? ''
  const result = analysis.data ?? savedAnalysis.data
  const hasNewDepartureTime = Boolean(savedAnalysis.data && departureTime && departureTime !== savedDepartureTime)

  useEffect(() => {
    if (savedAnalysis.data) {
      setDepartureTime(current => current || savedAnalysis.data!.configuration.departure_time.slice(0, 5))
    }
  }, [savedAnalysis.data])

  const clearResult = () => {
    if (analysis.data || analysis.error) analysis.reset()
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!classId || !date || !departureTime) return
    analysis.mutate({ class_id: classId, date, departure_time: departureTime })
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      <PageHeader
        title="Departure Anomalies"
        description="Review probable missing or unusually early departure scans."
      />

      <Alert>
        <ShieldAlert />
        <AlertTitle>Decision-support only</AlertTitle>
        <AlertDescription>
          A flag is not proof of bunking. Verify device issues, approved leave, transport arrangements,
          and staff permission before taking action.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run analysis</CardTitle>
          <CardDescription>Enter the official departure time for this class on this specific date.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_220px_180px_auto] lg:items-start">
            <div className="space-y-1.5">
              <Label className="text-xs">Class</Label>
              <Select
                value={classId}
                onValueChange={value => {
                  setClassId(value)
                  setDepartureTime('')
                  clearResult()
                }}
                disabled={classesLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={classesLoading ? 'Loading classes...' : 'Select class'} />
                </SelectTrigger>
                <SelectContent>
                  {classes.filter(item => item.is_active).map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.grade}-{item.section})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DateFilter
              mode="date"
              value={date}
              onChange={value => {
                setDate(value)
                setDepartureTime('')
                clearResult()
              }}
              label="Attendance date"
            />

            {canWriteDepartureAnalysis && <div className="space-y-1.5">
              <Label htmlFor="departure-analysis-time" className="text-xs">Departure time</Label>
              <Input
                id="departure-analysis-time"
                type="time"
                step={60}
                value={departureTime}
                onChange={event => {
                  setDepartureTime(event.target.value)
                  clearResult()
                }}
                required
              />
              <p className="text-[11px] text-muted-foreground">For the selected class and date only</p>
            </div>}

            {canWriteDepartureAnalysis && <Button
              type="submit"
              className="w-full sm:self-end lg:mb-[22px] lg:w-auto"
              disabled={!classId || !date || !departureTime || analysis.isPending}
            >
              <Search className={analysis.isPending ? 'animate-pulse' : ''} />
              {analysis.isPending
                ? 'Analyzing...'
                : hasNewDepartureTime
                  ? 'Analyze again'
                  : savedAnalysis.data
                    ? 'Refresh analysis'
                    : 'Analyze'}
            </Button>}
          </form>
        </CardContent>
      </Card>

      {analysis.isPending && <AnalysisSkeleton />}

      {!analysis.isPending && savedAnalysis.isLoading && classId && <AnalysisSkeleton />}

      {analysis.error && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Analysis could not be completed</AlertTitle>
          <AlertDescription>{analysis.error.message}</AlertDescription>
        </Alert>
      )}

      {savedAnalysis.error && !analysis.error && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Saved analysis could not be loaded</AlertTitle>
          <AlertDescription>{savedAnalysis.error.message}</AlertDescription>
        </Alert>
      )}

      {result && !analysis.isPending && (
        <>
          {hasNewDepartureTime && (
            <Alert>
              <Clock3 />
              <AlertTitle>New departure time entered</AlertTitle>
              <AlertDescription>
                The report below uses {formatTimeWithPeriod(result.configuration.departure_time)}.
                Select “Analyze again” to recalculate it using {formatTimeWithPeriod(departureTime)}.
              </AlertDescription>
            </Alert>
          )}
          <AnalysisResults result={result} />
        </>
      )}
    </div>
  )
}

function AnalysisResults({ result }: { result: DepartureAnalysisResponse }) {
  return (
    <div className="space-y-3 sm:space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{result.class.name}</span>
        <span>·</span>
        <span>{formatDisplayDate(result.date)}</span>
        <span>·</span>
        <span>Departure {formatTimeWithPeriod(result.configuration.departure_time)}</span>
        {result.cached && <Badge variant="outline">Cached result</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <SummaryCard icon={ShieldAlert} label="Flagged" value={result.summary.total_flagged} />
        <SummaryCard icon={UserX} label="No departure" value={result.summary.by_category.missing_departure} />
        <SummaryCard icon={Clock3} label="Early" value={result.summary.by_category.significantly_early} />
        <SummaryCard icon={TrendingDown} label="Outliers" value={result.summary.by_category.statistical_outlier} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Users /> Class evidence</CardTitle>
          <CardDescription>Robust cohort statistics used by the analysis</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Active students" value={result.cohort.total_active_students} />
          <Metric label="Arrived" value={result.cohort.students_arrived} />
          <Metric label="Departures" value={result.cohort.with_departure} />
          <Metric label="Median departure" value={timeValue(result.cohort.median_departure_time)} />
          <Metric label="MAD" value={minuteValue(result.cohort.mad_minutes)} />
          <Metric
            label="Outlier statistics"
            value={result.cohort.statistics_reliable ? 'Reliable' : 'Small cohort'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flagged students</CardTitle>
          <CardDescription>
            {result.flagged_students.length
              ? 'Ordered by risk score. Review every reason before following up.'
              : 'No departure anomalies were identified with the selected inputs.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.flagged_students.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No students were flagged.</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Scans</TableHead>
                      <TableHead>Categories</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Reasons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.flagged_students.map(student => (
                      <StudentTableRow key={student.student_id} student={student} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 md:hidden">
                {result.flagged_students.map(student => (
                  <StudentMobileCard key={student.student_id} student={student} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StudentTableRow({ student }: { student: FlaggedDepartureStudent }) {
  return (
    <TableRow>
      <TableCell className="min-w-44 align-top">
        <p className="font-medium">{student.student_name}</p>
        <p className="text-xs text-muted-foreground">
          {student.admission_number}{student.roll_number == null ? '' : ` · Roll ${student.roll_number}`}
        </p>
      </TableCell>
      <TableCell className="whitespace-nowrap align-top text-xs">
        <p>In: {timeValue(student.arrival_time)}</p>
        <p>Out: {timeValue(student.departure_time)}</p>
      </TableCell>
      <TableCell className="max-w-52 align-top"><CategoryBadges categories={student.categories} /></TableCell>
      <TableCell className="align-top"><RiskBadge level={student.risk_level} score={student.risk_score} /></TableCell>
      <TableCell className="min-w-72 align-top"><ReasonList student={student} /></TableCell>
    </TableRow>
  )
}

function StudentMobileCard({ student }: { student: FlaggedDepartureStudent }) {
  return (
    <article className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{student.student_name}</p>
          <p className="text-xs text-muted-foreground">
            {student.admission_number}{student.roll_number == null ? '' : ` · Roll ${student.roll_number}`}
          </p>
        </div>
        <RiskBadge level={student.risk_level} score={student.risk_score} />
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span>In: <strong className="text-foreground">{timeValue(student.arrival_time)}</strong></span>
        <span>Out: <strong className="text-foreground">{timeValue(student.departure_time)}</strong></span>
      </div>
      <div className="mt-3"><CategoryBadges categories={student.categories} /></div>
      <div className="mt-3 border-t pt-3"><ReasonList student={student} /></div>
    </article>
  )
}

function ReasonList({ student }: { student: FlaggedDepartureStudent }) {
  return (
    <ul className="space-y-1.5 text-xs text-muted-foreground">
      {student.reasons.map(reason => (
        <li key={reason.code} className="leading-relaxed">• {reason.message}</li>
      ))}
      <li className="text-[11px]">Confidence: {student.confidence}</li>
    </ul>
  )
}

function CategoryBadges({ categories }: { categories: DepartureAnomalyCategory[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {categories.map(category => (
        <Badge key={category} variant="secondary" className="text-[10px]">
          {categoryLabels[category]}
        </Badge>
      ))}
    </div>
  )
}

function RiskBadge({ level, score }: { level: DepartureRiskLevel; score: number }) {
  const className = level === 'High'
    ? 'bg-red-600 text-white hover:bg-red-600'
    : level === 'Medium'
      ? 'bg-amber-500 text-white hover:bg-amber-500'
      : 'bg-blue-600 text-white hover:bg-blue-600'
  return <Badge className={className}>{level} · {score}</Badge>
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3 sm:p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold sm:text-2xl">{value}</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

function timeValue(value: string | null) {
  return value ? formatTimeWithPeriod(value) : '—'
}

function minuteValue(value: number | null) {
  return value == null ? '—' : `${value} min`
}
