import { useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import { useStudents } from '@/hooks/useStudents'
import { fineCollectionsService, type FineMonth, type FinePayment } from '@/services/fineCollections'
import type { StudentWithClass } from '@/types/database'
import { formatDisplayDate, splitBangladeshDateTime } from '@/lib/dateTime'
import { formatFine } from '@/lib/attendanceFine'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState, LoadingState } from '@/components/shared/PageHeader'
import { FINE_ACCOUNTS_KEY, FineStatus, PaymentReceipts, useFineAccount } from './FinePaymentHistory'
import { FineReceiptButton } from './FineReceipts'

export function FineCollectionPage() {
  const { role } = useAuth()
  return role === 'admin' ? <FineCollectionWorkspace /> : <Navigate to="/dashboard" replace />
}

function FineCollectionWorkspace() {
  const [classId, setClassId] = useState('all')
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const classes = useClasses()
  const students = useStudents(classId === 'all' ? undefined : classId)
  const student = students.data?.find(row => row.id === studentId)
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = (students.data ?? []).filter(row => terms.every(term => `${row.first_name} ${row.last_name} ${row.admission_number} ${row.roll_number ?? ''}`.toLowerCase().includes(term)))
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 25)))
  return <div className="min-w-0 space-y-5">
    <div><h1 className="text-2xl font-bold">Fine Collection</h1><p className="mt-1 text-sm text-muted-foreground">Collect outstanding fines and issue receipts.</p></div>
    {student ? <><Button variant="ghost" className="px-0" onClick={() => setStudentId(null)}><ArrowLeft className="mr-2 h-4 w-4" />All students</Button>
      <StudentFineCollection key={student.id} student={student} /></>
      : <>
        <div className="flex flex-col gap-3 sm:flex-row"><div className="w-full space-y-1.5 sm:w-72"><Label htmlFor="collection-class">Class</Label>
          <Select value={classId} onValueChange={value => { setClassId(value); setPage(1) }}><SelectTrigger id="collection-class" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All classes</SelectItem>{classes.data?.map(row => <SelectItem key={row.id} value={row.id}>{row.name} · {row.academic_years?.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="collection-search">Student</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="collection-search" className="pl-9" placeholder="Search name, student ID or roll" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></div></div>
        </div>
        {students.isPending ? <LoadingState /> : students.isError ? <ErrorState message="Could not load students." />
          : <><Table><TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Student ID</TableHead><TableHead>Class</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{rows.slice((currentPage - 1) * 25, currentPage * 25).map(row => <TableRow key={row.id} className="cursor-pointer" onClick={() => setStudentId(row.id)}>
              <TableCell className="font-medium">{row.first_name} {row.last_name}</TableCell><TableCell>{row.admission_number}</TableCell><TableCell>{row.classes?.name ?? 'Unassigned'}</TableCell>
              <TableCell className="text-right"><Button size="sm" variant="ghost" aria-label={`Collect fine for ${row.first_name} ${row.last_name}`} onClick={event => { event.stopPropagation(); setStudentId(row.id) }}>Open<ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell>
            </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No students found.</TableCell></TableRow>}</TableBody></Table>
            {rows.length > 25 && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{rows.length} students · Page {currentPage}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage * 25 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>}
          </>}
      </>}
  </div>
}

function StudentFineCollection({ student }: { student: StudentWithClass }) {
  const today = splitBangladeshDateTime(new Date()).date
  const [until, setUntil] = useState(today)
  const [waiverInput, setWaiverInput] = useState('0')
  const [month, setMonth] = useState<FineMonth | null>(null)
  const [receipt, setReceipt] = useState<FinePayment | null>(null)
  const account = useFineAccount(student.id, until)
  const qc = useQueryClient()
  const waiver = Number(waiverInput)
  const quote = account.data?.quote
  const requestRef = useRef({ key: '', id: '' })
  const fingerprint = `${quote?.from_date}:${quote?.to_date}:${quote?.gross_amount}:${waiverInput}`
  if (requestRef.current.key !== fingerprint) requestRef.current = { key: fingerprint, id: crypto.randomUUID() }
  const payment = useMutation({
    mutationFn: () => {
      if (!quote || !quote.eligible || !Number.isFinite(waiver) || waiver < 0 || waiver > Number(quote.gross_amount) || !/^\d+(\.\d{1,2})?$/.test(waiverInput)) throw new Error('Enter a valid waiver no larger than the fine.')
      return fineCollectionsService.collect(student.id, quote, waiver, requestRef.current.id)
    },
    onSuccess: receipt => {
      setReceipt(receipt); setWaiverInput('0')
      void qc.invalidateQueries({ queryKey: [FINE_ACCOUNTS_KEY, student.id] })
      toast.success('Payment recorded. Receipt is ready to print.')
    },
    onError: (error: Error) => { toast.error(error.message); if (/changed|Refresh/.test(error.message)) void account.refetch() },
  })
  if (account.isPending) return <LoadingState message="Loading fine account..." />
  if (account.isError) return <div><ErrorState message="Could not load this fine account." /><Button variant="outline" onClick={() => void account.refetch()}>Retry</Button></div>
  const data = account.data
  const validWaiver = Number.isFinite(waiver) && waiver >= 0 && waiver <= Number(data.quote.gross_amount) && /^\d+(\.\d{1,2})?$/.test(waiverInput)
  return <div className="space-y-6">
    <header className=""><h2 className="text-lg font-semibold">{student.first_name} {student.last_name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{student.admission_number} · {student.classes?.name ?? 'Unassigned'} · {student.student_phone || student.guardian_phone || 'No mobile number'}</p>
      <p className={`mt-2 text-sm ${data.paid_through ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{data.paid_through ? `Paid through ${formatDisplayDate(data.paid_through)}. Next period starts ${formatDisplayDate(data.next_start)}.` : 'No fine periods have been paid yet.'}</p></header>
    <section className="rounded-lg border p-4 sm:p-5" aria-label="Collect unpaid fine">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-sm font-semibold">Unpaid fine</h3><p className="mt-1 text-xs text-muted-foreground">{data.quote.eligible ? `${formatDisplayDate(data.quote.from_date)} to ${formatDisplayDate(until)} (inclusive)` : 'This date is already covered by a payment.'}</p></div>
        <p className="text-2xl font-semibold tabular-nums">{formatFine(Number(data.quote.gross_amount))}</p></div>
      <div className="mt-5 grid items-end gap-4 sm:grid-cols-4"><div className="space-y-2"><Label htmlFor="fine-until">Collect upto</Label><Input id="fine-until" type="date" max={today} value={until} disabled={payment.isPending} onChange={event => { if (event.target.value) { setUntil(event.target.value); setReceipt(null); setWaiverInput('0') } }} /></div>
        <div className="space-y-2"><Label htmlFor="fine-waiver">Waiver amount</Label><Input id="fine-waiver" type="number" inputMode="decimal" min="0" max={Number(data.quote.gross_amount)} step="0.01" value={waiverInput} disabled={payment.isPending || !data.quote.eligible} aria-invalid={!validWaiver} onChange={event => setWaiverInput(event.target.value)} /></div>
        <div><p className="text-xs text-muted-foreground">Amount to receive</p><p className="mt-2 text-xl font-semibold tabular-nums">{formatFine(validWaiver ? Number(data.quote.gross_amount) - waiver : 0)}</p></div>
        <Button disabled={!data.quote.eligible || !validWaiver || account.isFetching || payment.isPending} onClick={() => payment.mutate()}>{payment.isPending ? 'Recording...' : 'Mark paid'}</Button>
      </div>
      {!validWaiver && <p className="mt-2 text-xs text-destructive">Waiver must be between zero and the fine, with at most two decimal places.</p>}
      {data.quote.fine && <p className="mt-4 text-xs text-muted-foreground">Attendance: {formatFine(Number(data.quote.fine.attendanceFine))} · Missed exams: {formatFine(Number(data.quote.fine.examMissedFine))}. Every two late days add one absence fine; late days carry across payments.</p>}
      {receipt && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-emerald-600 dark:text-emerald-400">Paid {formatFine(Number(receipt.paid_amount))} through {formatDisplayDate(receipt.period_end)}</p><FineReceiptButton payment={receipt} /></div>}
    </section>
    <section><h3 className="mb-3 text-sm font-semibold">Monthly history</h3><p className="mb-3 text-xs text-muted-foreground">Unpaid balances are through {formatDisplayDate(today)}. Use Details to view attendance and missed exams.</p>
      <Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Waiver</TableHead><TableHead className="text-right">Unpaid</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
        <TableBody>{data.months.map(row => <TableRow key={row.month}><TableCell className="font-medium">{format(parseISO(row.month), 'MMM yyyy')}</TableCell>
          <TableCell><FineStatus status={row.status} />{row.paid_through && <span className="block text-[11px] text-muted-foreground">Through {formatDisplayDate(row.paid_through)}</span>}</TableCell>
          <TableCell className="text-right">{formatFine(Number(row.settled.paid_amount))}</TableCell><TableCell className="text-right">{formatFine(Number(row.settled.waiver_amount))}</TableCell><TableCell className="text-right">{formatFine(Number(row.unpaid_amount))}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" aria-label={`View details for ${format(parseISO(row.month), 'MMMM yyyy')}`} onClick={() => setMonth(row)}>Details<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></TableCell></TableRow>)}
          {!data.months.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No monthly records yet.</TableCell></TableRow>}</TableBody></Table>
    </section>
    <PaymentReceipts account={data} />
    <Sheet open={Boolean(month)} onOpenChange={open => { if (!open) setMonth(null) }}><SheetContent className="w-full gap-0 sm:max-w-xl">
      <SheetHeader className="border-b pr-12"><SheetTitle>{month ? format(parseISO(month.month), 'MMMM yyyy') : 'Month details'}</SheetTitle><SheetDescription>{student.first_name} {student.last_name} · Fine and attendance details</SheetDescription></SheetHeader>
      {month && <FineMonthPanel key={month.month} studentId={student.id} month={data.months.find(row => row.month === month.month) ?? month} payments={data.payments} />}
    </SheetContent></Sheet>
  </div>
}

function FineMonthPanel({ studentId, month, payments }: { studentId: string; month: FineMonth; payments: FinePayment[] }) {
  const query = useQuery({ queryKey: ['fine-month', studentId, month.month], queryFn: ({ signal }) => fineCollectionsService.month(studentId, month.month, signal), staleTime: 30_000 })
  return <div className="min-h-0 space-y-6 overflow-y-auto p-4">
    <div className="flex justify-between gap-3"><div><FineStatus status={month.status} />{month.paid_through && <p className="mt-1 text-xs text-muted-foreground">Paid through {formatDisplayDate(month.paid_through)}</p>}</div><div className="text-right"><p className="text-xs text-muted-foreground">Unpaid</p><p className="text-lg font-semibold">{formatFine(Number(month.unpaid_amount))}</p></div></div>
    <dl className="flex gap-8 border-y py-3 text-sm"><div><dt className="text-xs text-muted-foreground">Received</dt><dd className="mt-1 font-semibold">{formatFine(Number(month.settled.paid_amount))}</dd></div><div><dt className="text-xs text-muted-foreground">Waived</dt><dd className="mt-1 font-semibold">{formatFine(Number(month.settled.waiver_amount))}</dd></div></dl>
    {payments.filter(payment => payment.monthly_breakdown.some(item => item.month === month.month)).map(payment => <div key={payment.id} className="flex items-center justify-between gap-2 border-b pb-3"><p className="text-xs">{formatDisplayDate(payment.period_start)} to {formatDisplayDate(payment.period_end)}</p><FineReceiptButton payment={payment} /></div>)}
    {query.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading month details...</p> : query.isError ? <p role="alert" className="text-sm text-destructive">Could not load details. <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></p> : <>
      <section><h3 className="mb-2 text-sm font-semibold">Attendance</h3>{!query.data.attendance.length ? <p className="text-sm text-muted-foreground">No attendance records.</p> : <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{query.data.attendance.map(row => <TableRow key={row.id}><TableCell>{formatDisplayDate(row.date)}</TableCell><TableCell className="capitalize">{row.status === 'too_late' ? 'Too late' : row.status === 'excused' ? 'Approved leave' : row.status}</TableCell></TableRow>)}</TableBody></Table>}</section>
      <section><h3 className="mb-2 text-sm font-semibold">Missed exams</h3>{!query.data.missed_exams.length ? <p className="text-sm text-muted-foreground">No missed exams.</p> : <div className="divide-y">{query.data.missed_exams.map(row => <div key={row.id} className="py-2 text-sm"><p className="font-medium">{row.exam}</p><p className="mt-1 text-xs text-muted-foreground">{formatDisplayDate(row.date)} · {row.subject}</p></div>)}</div>}</section>
    </>}
  </div>
}
