import { PageHeader } from '@/components/shared/PageHeader'
import { PunchHistoryCard } from '@/components/attendance/PunchHistoryCard'

export function RecentPunchesPage() {
  return (
    <div>
      <PageHeader
        title="Recent Punches"
        description="Review biometric punches recorded across all students."
      />
      <PunchHistoryCard
        title="Daily Punch History"
        description="One row per student and day, showing arrival and departure"
      />
    </div>
  )
}
