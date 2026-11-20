import { useState } from 'react'
import { FinePaymentHistory } from './FinePaymentHistory'
import { endOfMonth, format, parseISO } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentFineDetails } from '@/hooks/useStudentDashboard'
import { AttendanceFineCard } from '@/components/attendance/AttendanceFineCard'
import { EmptyState, PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function StudentFineDetailsPage() {
  const { student } = useAuth()
  const [period, setPeriod] = useState('all')
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const monthDate = parseISO(`${month}-01`)
  const startDate = period === 'month' ? `${month}-01` : undefined
  const endDate = period === 'month' ? format(endOfMonth(monthDate), 'yyyy-MM-dd') : undefined
  const { data: fine, isLoading, error } = useStudentFineDetails(student?.id, startDate, endDate)

  if (!student) return <EmptyState title="Student profile not linked" description="Contact your administrator." />

  return <div className="w-full max-w-3xl">
    <PageHeader title="Fine Details" description="Attendance and missed-exam fines." />
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="w-full space-y-2 sm:w-44">
        <Label htmlFor="fine-period">Period</Label>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger id="fine-period" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All time</SelectItem><SelectItem value="month">By month</SelectItem></SelectContent>
        </Select>
      </div>
      {period === 'month' && <div className="w-full space-y-2 sm:w-48">
        <Label htmlFor="fine-month">Month</Label>
        <Input id="fine-month" type="month" value={month} onChange={event => {
          const value = event.target.value
          if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0) setMonth(value)
        }} />
      </div>}
    </div>
    <AttendanceFineCard
      showTitle={false}
      absentCount={fine?.recordedAbsences ?? 0}
      lateCount={fine?.lateDays ?? 0}
      finePerAbsentDay={Number(fine?.finePerAbsentDay ?? 0)}
      examMissedCount={fine?.examMissedCount ?? 0}
      examMissedFineAmount={Number(fine?.examMissedFineAmount ?? 0)}
      periodLabel={period === 'month' ? format(monthDate, 'MMMM yyyy') : 'All-time fine breakdown'}
      loading={isLoading}
      error={Boolean(error)}
    />
    <div className="mt-7"><FinePaymentHistory studentId={student.id} /></div>
  </div>
}
