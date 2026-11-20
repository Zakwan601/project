import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { fineCollectionsService, type FineAccount } from '@/services/fineCollections'
import { splitBangladeshDateTime, formatDisplayDate } from '@/lib/dateTime'
import { formatFine } from '@/lib/attendanceFine'
import { FineReceiptButton, fineReceiptNumber } from './FineReceipts'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'

export const FINE_ACCOUNTS_KEY = 'fine-account'
export function useFineAccount(studentId: string, until: string) {
  return useQuery({ queryKey: [FINE_ACCOUNTS_KEY, studentId, until],
    queryFn: ({ signal }) => fineCollectionsService.account(studentId, until, signal), staleTime: 30_000 })
}
export function FinePaymentHistory({ studentId }: { studentId: string }) {
  const today = splitBangladeshDateTime(new Date()).date
  const query = useFineAccount(studentId, today)
  if (query.isPending) return <p role="status" className="py-4 text-sm text-muted-foreground">Loading fine payments...</p>
  if (query.isError) return <div role="alert" className="py-4 text-sm text-destructive">Could not load fine payments. <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></div>
  return <section className="space-y-4" aria-label="Fine payment history">
    <div className="flex flex-wrap items-start justify-between gap-4 border-y py-4"><div><h3 className="text-sm font-semibold">Fine payments</h3>
      <p className="mt-1 text-xs text-muted-foreground">{query.data.paid_through ? `Paid through ${formatDisplayDate(query.data.paid_through)}. Next period: ${formatDisplayDate(query.data.next_start)}.` : 'No periods paid yet.'}</p></div>
      <div className="text-right"><p className="text-xs text-muted-foreground">Unpaid through {formatDisplayDate(today)}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatFine(Number(query.data.quote.gross_amount))}</p></div>
    </div>
    <PaymentStatusMonths account={query.data} />
    <PaymentReceipts account={query.data} />
  </section>
}
export function PaymentStatusMonths({ account }: { account: FineAccount }) {
  return !account.months.length ? null : <Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Waived</TableHead><TableHead className="text-right">Unpaid</TableHead></TableRow></TableHeader>
    <TableBody>{account.months.map(row => <TableRow key={row.month}><TableCell>{format(parseISO(row.month), 'MMM yyyy')}</TableCell>
      <TableCell><FineStatus status={row.status} />{row.status === 'partial' && <span className="block text-[11px] text-muted-foreground">Paid through {formatDisplayDate(row.paid_through!)}</span>}</TableCell>
      <TableCell className="text-right tabular-nums">{formatFine(Number(row.settled.paid_amount))}</TableCell><TableCell className="text-right tabular-nums">{formatFine(Number(row.settled.waiver_amount))}</TableCell><TableCell className="text-right tabular-nums">{formatFine(Number(row.unpaid_amount))}</TableCell></TableRow>)}</TableBody></Table>
}
export function FineStatus({ status }: { status: 'paid' | 'partial' | 'unpaid' }) {
  return <span className={`text-xs font-medium ${status === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : status === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'}`}>
    {status === 'paid' ? 'Paid' : status === 'partial' ? 'Partly paid' : 'Unpaid'}</span>
}
export function PaymentReceipts({ account }: { account: FineAccount }) {
  return <section className="space-y-3"><h3 className="text-sm font-semibold">Payment receipts</h3>
    {!account.payments.length ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : <div className="divide-y">{account.payments.map(payment => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p className="text-sm font-medium">{fineReceiptNumber(payment)} <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">Paid</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDisplayDate(payment.period_start)} to {formatDisplayDate(payment.period_end)} · Received {formatFine(Number(payment.paid_amount))} · Waived {formatFine(Number(payment.waiver_amount))}</p>
        <p className="mt-1 text-xs text-muted-foreground">Collected by {payment.collector_name}</p></div><FineReceiptButton payment={payment} /></div>)}</div>}
  </section>
}
