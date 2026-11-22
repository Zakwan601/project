import { useRef } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatFine } from '@/lib/attendanceFine'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { printReportCards } from '@/lib/printReportCard'
import type { FinePayment } from '@/services/fineCollections'

export function fineReceiptNumber(payment: FinePayment) {
  return `FC-${String(payment.receipt_number).padStart(6, '0')}`
}

export function FineReceiptButton({ payment }: { payment: FinePayment }) {
  const receiptRef = useRef<HTMLDivElement>(null)
  return <>
    <Button variant="outline" size="sm" className="print:hidden" aria-label={`Print receipt ${fineReceiptNumber(payment)}`} onClick={() => {
      if (receiptRef.current) printReportCards([receiptRef.current])
    }}><Printer className="mr-1.5 h-3.5 w-3.5" />Print receipt</Button>
    <div className="hidden"><div ref={receiptRef} className="fine-receipt-page">
      {['Student copy', 'Office copy'].map(copy => <section key={copy} className="fine-receipt-copy">
        <p className="mb-1 text-center text-xs">Internal Money Receipt</p>
        <div className="flex items-start justify-between gap-4"><div>
          <img src="https://ik.imagekit.io/nmdc/nmdc_logo.jpg" alt="NMDC Logo" className="fine-receipt-logo mb-2 h-10 w-10 object-contain" />
          <p className="text-lg font-bold">New Model Degree College</p>
          <h2 className="mt-1 text-base font-semibold">Fine collection receipt</h2></div><span className="text-xs">{copy}</span></div>
        <div className="my-3 flex justify-between border-y py-2 text-xs"><strong>{fineReceiptNumber(payment)}</strong><span>{formatDisplayDateTime(payment.collected_at)}</span></div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Student" value={payment.student_snapshot.name} /><Field label="Student ID" value={payment.student_snapshot.student_id} />
          <Field label="Class" value={payment.student_snapshot.class_name ?? '-'} />
          <Field label="Mobile number" value={payment.student_snapshot.student_phone || payment.student_snapshot.guardian_phone || '-'} />
          <Field label="Fine period from" value={formatDisplayDate(payment.period_start)} /><Field label="Upto (inclusive)" value={formatDisplayDate(payment.period_end)} />
        </dl>
        <dl className="mt-4 space-y-2 border-y py-3 text-sm">
          <Amount label="Fine assessed" value={Number(payment.gross_amount)} />
          <Amount label="Waiver" value={Number(payment.waiver_amount)} />
          <Amount label="Amount received" value={Number(payment.paid_amount)} bold />
        </dl>
        <div className="fine-receipt-footer mt-8 flex items-end justify-between gap-6 text-xs"><p>Paid upto {formatDisplayDate(payment.period_end)}.<br /></p>
          <div className="min-w-44 text-center"><p className="border-t pt-2">Collector signature</p><p className="mt-1 font-semibold">{payment.collector_name}</p></div></div>
      </section>)}
    </div></div>
  </>
}
function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>
}
function Amount({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}><dt>{label}</dt><dd>{formatFine(value)}</dd></div>
}
