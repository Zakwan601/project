import { Archive } from 'lucide-react'
import { PunchHistoryCard } from '@/components/attendance/PunchHistoryCard'
import { PageHeader } from '@/components/shared/PageHeader'
import { useClasses } from '@/hooks/useClasses'

export function ArchivedPunchesPage() {
  const { data: classes = [] } = useClasses()

  return (
    <div>
      <PageHeader
        title="Archived Punches"
        description="View punches moved to the external archive. Select a date to load archived data."
      />
      <div className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
        <Archive className="mt-0.5 h-4 w-4 shrink-0" />
        <p>The archive database is queried only after you select a date on this page.</p>
      </div>
      <PunchHistoryCard
        title="Archived Punch History"
        description=""
        variant="table"
        classes={classes}
        source="archive"
      />
    </div>
  )
}
