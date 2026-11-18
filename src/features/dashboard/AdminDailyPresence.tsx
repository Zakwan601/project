import { Link } from 'react-router-dom'
import { useAdminDailyPresence } from '@/hooks/useDashboard'
import { splitBangladeshDateTime } from '@/lib/dateTime'
import type { DailyPresenceCounts } from '@/services/dashboard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function AdminDailyPresence() {
  const date = splitBangladeshDateTime(new Date()).date
  const { data, isLoading, error, refetch, isFetching } = useAdminDailyPresence(date)
  const classes = data?.classes.filter(row => row.class_id !== null) ?? []
  return <section className="min-w-0 space-y-5 " aria-labelledby="daily-presence-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="daily-presence-title" className="text-base font-semibold">Daily presence report</h2><p className="mt-1 text-xs text-muted-foreground">Today's attendance by class.</p></div>
    </div>
    {isLoading ? <div className="space-y-3" role="status" aria-label="Loading daily presence report">{[0, 1, 2].map(row => <Skeleton key={row} className="h-8 w-full" />)}</div>
      : error ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-destructive">Could not load the daily presence report.</p><Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry</Button></div>
        : <>
          <section className="min-w-0" aria-labelledby="class-presence-title">
            <Table className="min-w-[540px] text-xs sm:text-sm">
              <TableHeader><TableRow><TableHead>Class</TableHead><CountHeadings /></TableRow></TableHeader>
              <TableBody>{classes.map(row => <TableRow key={row.class_id}>
                <TableCell className="font-medium">{row.class_id ? <Link className="underline-offset-4 hover:underline" to={`/attendance?date=${date}&class_id=${row.class_id}`}>{row.class_name}</Link> : row.class_name}</TableCell>
                <CountCells row={row} />
              </TableRow>)}{!classes.length && <TableRow><TableCell colSpan={7} className="py-5 text-center text-muted-foreground">No classes to report.</TableCell></TableRow>}</TableBody>
            </Table>
          </section>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Each student is counted once per day. Late arrivals and approved leave count toward the attendance rate; too-late arrivals count as absent.</p>
        </>}
  </section>
}

function CountHeadings() {
  return <>{['Students', 'Present', 'Late', 'Absent', 'Leave', 'Rate'].map(label => <TableHead key={label} className="text-right">{label}</TableHead>)}</>
}
function CountCells({ row }: { row: DailyPresenceCounts }) {
  return <>
    {[row.students, row.present, row.late, row.absent, row.excused].map((value, index) => <TableCell key={index} className="text-right tabular-nums">{value}</TableCell>)}
    <TableCell className="text-right font-medium tabular-nums">{row.rate === null ? '-' : `${row.rate}%`}</TableCell>
  </>
}
