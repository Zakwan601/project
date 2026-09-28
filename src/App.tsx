import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { AppLayout } from '@/components/layout/AppLayout'

const LoginPage = lazyWithRetry(() => import('@/features/auth/LoginPage'), module => module.LoginPage)
const DashboardPage = lazyWithRetry(() => import('@/features/dashboard/DashboardPage'), module => module.DashboardPage)
const StudentsPage = lazyWithRetry(() => import('@/features/students/StudentsPage'), module => module.StudentsPage)
const ClassesPage = lazyWithRetry(() => import('@/features/classes/ClassesPage'), module => module.ClassesPage)
const AttendancePage = lazyWithRetry(() => import('@/features/attendance/AttendancePage'), module => module.AttendancePage)
const ReportsPage = lazyWithRetry(() => import('@/features/reports/ReportsPage'), module => module.ReportsPage)
const DevicesPage = lazyWithRetry(() => import('@/features/devices/DevicesPage'), module => module.DevicesPage)
const SettingsPage = lazyWithRetry(() => import('@/features/settings/SettingsPage'), module => module.SettingsPage)
const ProfilePage = lazyWithRetry(() => import('@/features/profile/ProfilePage'), module => module.ProfilePage)
const RecentPunchesPage = lazyWithRetry(() => import('@/features/punches/RecentPunchesPage'), module => module.RecentPunchesPage)
const ArchivedPunchesPage = lazyWithRetry(() => import('@/features/punches/ArchivedPunchesPage'), module => module.ArchivedPunchesPage)
const StudentReportsPage = lazyWithRetry(() => import('@/features/reports/StudentReportsPage'), module => module.StudentReportsPage)
const ComplaintsPage = lazyWithRetry(() => import('@/features/reports/ComplaintsPage'), module => module.ComplaintsPage)
const SmsMessagesPage = lazyWithRetry(() => import('@/features/sms/SmsMessagesPage'), module => module.SmsMessagesPage)
const AnnouncementsPage = lazyWithRetry(() => import('@/features/announcements/AnnouncementsPage'), module => module.AnnouncementsPage)
const DepartureAnomaliesPage = lazyWithRetry(() => import('@/features/departure-anomalies/DepartureAnomaliesPage'), module => module.DepartureAnomaliesPage)
const VacationsPage = lazyWithRetry(() => import('@/features/vacations/VacationsPage'), module => module.VacationsPage)
const AccessControlPage = lazyWithRetry(() => import('@/features/access/AccessControlPage'), module => module.AccessControlPage)
const ResultsPage = lazyWithRetry(() => import('@/features/results/ResultsPage'), module => module.ResultsPage)
const SharedResultPage = lazyWithRetry(() => import('@/features/results/SharedResultPage'), module => module.SharedResultPage)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function AppLoadingFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background" role="status" aria-label="Loading application">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="sr-only">Loading application</span>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="Axentra@Zuanshi-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<AppLoadingFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/shared-result/:token" element={<SharedResultPage />} />

              {/* Protected app routes */}
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/students" element={<StudentsPage />} />
                <Route path="/classes" element={<ClassesPage />} />
                <Route path="/attendance" element={<AttendancePage />} />
                <Route
                  path="/punches"
                  element={(
                    <ProtectedRoute roles={['admin', 'student']}>
                      <RecentPunchesPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/archived-punches"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <ArchivedPunchesPage />
                    </ProtectedRoute>
                  )}
                />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/results/:examId" element={<ResultsPage />} />
                <Route
                  path="/complaints"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <ComplaintsPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/sms-messages"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <SmsMessagesPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/announcements"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <AnnouncementsPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/vacations"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <VacationsPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/departure-anomalies"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <DepartureAnomaliesPage />
                    </ProtectedRoute>
                  )}
                />
                <Route
                  path="/report-issue"
                  element={(
                    <ProtectedRoute roles={['student']}>
                      <StudentReportsPage />
                    </ProtectedRoute>
                  )}
                />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route
                  path="/access-control"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <AccessControlPage />
                    </ProtectedRoute>
                  )}
                />
              </Route>

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
