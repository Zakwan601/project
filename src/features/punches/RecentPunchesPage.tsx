import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { PunchHistoryCard } from '@/components/attendance/PunchHistoryCard'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentIdentity } from '@/hooks/useStudentDashboard'
import { DEVICE_LOGS_KEY } from '@/hooks/useDeviceLogs'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'

export function RecentPunchesPage() {
  const { role } = useAuth()
  const { data: student, isLoading, error } = useStudentIdentity()
  const queryClient = useQueryClient()
  const isRefreshing = useIsFetching({ queryKey: [DEVICE_LOGS_KEY] }) > 0
  const isStudent = role === 'student'

  const refreshPunches = () => queryClient.refetchQueries({
    queryKey: [DEVICE_LOGS_KEY],
    type: 'active',
  })

  if (isStudent && isLoading) return <LoadingState message="Loading your punches..." />
  if (isStudent && error) return <ErrorState message={(error as Error).message} />
  if (isStudent && !student) {
    return (
      <EmptyState
        title="Student profile not linked"
        description="Contact your administrator to view your punches."
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={isStudent ? 'My Punches' : 'Recent Punches'}
        description={isStudent
          ? 'Review your daily biometric arrival and departure times.'
          : 'Review biometric punches recorded across all students.'}
        action={(
          <Button variant="outline" size="sm" onClick={refreshPunches} disabled={isRefreshing}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        )}
      />
      <PunchHistoryCard
        admissionNumber={isStudent ? student?.admission_number : undefined}
        title={isStudent ? 'My Daily Punch History' : 'Daily Punch History'}
        description=""
        variant="table"
      />
    </div>
  )
}
