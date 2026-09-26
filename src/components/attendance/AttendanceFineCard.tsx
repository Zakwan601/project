import { Banknote } from 'lucide-react'
import { calculateAttendanceFine, formatFine } from '@/lib/attendanceFine'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface AttendanceFineCardProps {
  absentCount: number
  lateCount: number
  finePerAbsentDay: number
  periodLabel: string
  loading?: boolean
  error?: boolean
}

export function AttendanceFineCard({
  absentCount,
  lateCount,
  finePerAbsentDay,
  periodLabel,
  loading = false,
  error = false,
}: AttendanceFineCardProps) {
  const fine = calculateAttendanceFine(absentCount, lateCount, finePerAbsentDay)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b ">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-amber-600" /> Attendance Fine
            </CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </div>
          {loading ? <Skeleton className="h-8 w-24" /> : !error && <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{formatFine(fine.totalFine)}</p>}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {error ? (
          <p className="text-sm text-destructive">Could not load attendance fine details.</p>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map(item => <Skeleton key={item} className="h-14" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FineDetail label="Absent + too late" value={fine.recordedAbsences} />
              <FineDetail label="Late-day penalty" value={`+${fine.latePenaltyAbsences}`} hint={`${fine.lateDays} late day${fine.lateDays === 1 ? '' : 's'}`} />
              <FineDetail label="Fineable absences" value={fine.fineableAbsences} />
              <FineDetail label="Rate per absence" value={formatFine(fine.finePerAbsentDay)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Too Late counts as an absence. Every complete pair of Late days adds one more fineable absence. Approved leave does not incur a fine.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function FineDetail({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
