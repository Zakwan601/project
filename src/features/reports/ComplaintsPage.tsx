import { PageHeader } from '@/components/shared/PageHeader'
import { StudentReportNotifications } from '@/components/reports/StudentReportNotifications'

export function ComplaintsPage() {
  return (
    <div>
      <PageHeader
        title="Complaints"
        description="Review and resolve complaints submitted by students."
      />
      <StudentReportNotifications />
    </div>
  )
}
