import { calculateAttendanceFine, formatFine } from '@/lib/attendanceFine'
import { Skeleton } from '@/components/ui/skeleton'

interface AttendanceFineCardProps {
  absentCount: number
  lateCount: number
  finePerAbsentDay: number
  examMissedCount?: number
  examMissedFineAmount?: number
  periodLabel: string
  showTitle?: boolean
  loading?: boolean
  error?: boolean
}

export function AttendanceFineCard({
  absentCount,
  lateCount,
  finePerAbsentDay,
  examMissedCount = 0,
  examMissedFineAmount = 0,
  periodLabel,
  showTitle = true,
  loading = false,
  error = false,
}: AttendanceFineCardProps) {
  const fine = calculateAttendanceFine(absentCount, lateCount, finePerAbsentDay, examMissedCount, examMissedFineAmount)

  return (
    <section className="w-full max-w-3xl" aria-label="Fine details" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div>
          {showTitle && <h2 className="text-base font-semibold">Fine Details</h2>}
          <p className={`text-sm text-muted-foreground ${showTitle ? 'mt-1' : ''}`}>{periodLabel}</p>
        </div>
        {loading ? <Skeleton className="h-8 w-24" /> : !error && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total fine</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{formatFine(fine.totalFine)}</p>
          </div>
        )}
      </div>
      <div>
        {error ? (
          <p className="py-4 text-sm text-destructive">Could not load attendance fine details.</p>
        ) : loading ? (
          <div className="space-y-5 py-5" role="status" aria-label="Loading fine details">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : (
          <>
            <dl className="divide-y">
              <FineDetail
                label="Attendance fine"
                value={formatFine(fine.attendanceFine)}
                detail={`${fine.recordedAbsences} absent or too late · ${fine.lateDays} late days (+${fine.latePenaltyAbsences} penalty absences)`}
                calculation={`${fine.fineableAbsences} × ${formatFine(fine.finePerAbsentDay)}`}
              />
              <FineDetail
                label="Missed exam fine"
                value={formatFine(fine.examMissedFine)}
                detail={`${fine.examMissedCount} missed exam${fine.examMissedCount === 1 ? '' : 's'}`}
                calculation={`${fine.examMissedCount} × ${formatFine(fine.examMissedFineAmount)}`}
              />
            </dl>
            <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              Both fines apply on exam days with classes. Exam-only days carry only the missed exam fine. Approved leave is exempt.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function FineDetail({ label, value, detail, calculation }: { label: string; value: string; detail: string; calculation: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</dd>
      </div>
      <div className="shrink-0 text-right">
        <dd className="text-sm font-semibold tabular-nums">{value}</dd>
        <dd className="mt-1 text-xs tabular-nums text-muted-foreground">{calculation}</dd>
      </div>
    </div>
  )
}
