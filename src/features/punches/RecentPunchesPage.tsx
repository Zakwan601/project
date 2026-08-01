import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { PunchHistoryCard } from '@/components/attendance/PunchHistoryCard'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentIdentity } from '@/hooks/useStudentDashboard'

export function RecentPunchesPage() {
  const { role } = useAuth()
  const { data: student, isLoading, error } = useStudentIdentity()
  const isStudent = role === 'student'

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
      />
      <PunchHistoryCard
        admissionNumber={isStudent ? student?.admission_number : undefined}
        title={isStudent ? 'My Daily Punch History' : 'Daily Punch History'}
        description=""
        variant={isStudent ? 'list' : 'table'}
      />
    </div>
  )
}
