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
  return <section className="min-w-0 space-y-2 sm:space-y-5" aria-labelledby="daily-presence-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="daily-presence-title" className="text-base font-semibold">Today's Presence Report</h2></div>
    </div>
    {isLoading ? <div className="space-y-3" role="status" aria-label="Loading daily presence report">{[0, 1, 2].map(row => <Skeleton key={row} className="h-8 w-full" />)}</div>
      : error ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-destructive">Could not load the daily presence report.</p><Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry</Button></div>
        : <>
          <section className="min-w-0" aria-labelledby="class-presence-title">
            <Table className="w-full table-fixed text-[10px] min-[380px]:text-[11px] sm:min-w-[540px] sm:table-auto sm:text-sm">
              <TableHeader><TableRow><TableHead className="h-8 w-[40%] px-1 sm:h-10 sm:w-auto sm:px-2">Class</TableHead><CountHeadings /></TableRow></TableHeader>
              <TableBody>{classes.map(row => <TableRow key={row.class_id}>
                <TableCell className="whitespace-normal px-1 py-1.5 font-medium leading-tight sm:whitespace-nowrap sm:p-2 sm:leading-normal">{row.class_id ? <Link className="underline-offset-4 hover:underline" to={`/attendance?date=${date}&class_id=${row.class_id}`}>{row.class_name}</Link> : row.class_name}</TableCell>
                <CountCells row={row} />
              </TableRow>)}{!classes.length && <TableRow><TableCell colSpan={7} className="py-5 text-center text-muted-foreground">No classes to report.</TableCell></TableRow>}</TableBody>
            </Table>
          </section>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Each student is counted once per day. Late arrivals and approved leave count toward the attendance rate; too-late arrivals count as absent.</p>
        </>}
  </section>
}

function CountHeadings() {
  return <>{[['Students', 'Std.'], ['Present', 'Pres.'], ['Late', 'Late'], ['Absent', 'Abs.'], ['Leave', 'Leave'], ['Rate', 'Rate']].map(([label, short]) => <TableHead key={label} aria-label={label} title={label} className="h-8 px-0.5 text-right sm:h-10 sm:px-2"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></TableHead>)}</>
}
function CountCells({ row }: { row: DailyPresenceCounts }) {
  return <>
    {[row.students, row.present, row.late, row.absent, row.excused].map((value, index) => <TableCell key={index} className="px-0.5 py-1.5 text-right tabular-nums sm:p-2">{value}</TableCell>)}
    <TableCell className="px-0.5 py-1.5 text-right font-medium tabular-nums sm:p-2">{row.rate === null ? '-' : `${row.rate}%`}</TableCell>
  </>
}
