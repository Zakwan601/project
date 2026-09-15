import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'

const LoginPage = lazy(() => import('@/features/auth/LoginPage').then(module => ({ default: module.LoginPage })))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })))
const StudentsPage = lazy(() => import('@/features/students/StudentsPage').then(module => ({ default: module.StudentsPage })))
const ClassesPage = lazy(() => import('@/features/classes/ClassesPage').then(module => ({ default: module.ClassesPage })))
const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage').then(module => ({ default: module.AttendancePage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then(module => ({ default: module.ReportsPage })))
const DevicesPage = lazy(() => import('@/features/devices/DevicesPage').then(module => ({ default: module.DevicesPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(module => ({ default: module.SettingsPage })))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage').then(module => ({ default: module.ProfilePage })))
const RecentPunchesPage = lazy(() => import('@/features/punches/RecentPunchesPage').then(module => ({ default: module.RecentPunchesPage })))
const StudentReportsPage = lazy(() => import('@/features/reports/StudentReportsPage').then(module => ({ default: module.StudentReportsPage })))
const ComplaintsPage = lazy(() => import('@/features/reports/ComplaintsPage').then(module => ({ default: module.ComplaintsPage })))
const SmsMessagesPage = lazy(() => import('@/features/sms/SmsMessagesPage').then(module => ({ default: module.SmsMessagesPage })))
const AnnouncementsPage = lazy(() => import('@/features/announcements/AnnouncementsPage').then(module => ({ default: module.AnnouncementsPage })))
const DepartureAnomaliesPage = lazy(() => import('@/features/departure-anomalies/DepartureAnomaliesPage').then(module => ({ default: module.DepartureAnomaliesPage })))
const VacationsPage = lazy(() => import('@/features/vacations/VacationsPage').then(module => ({ default: module.VacationsPage })))
const AccessControlPage = lazy(() => import('@/features/access/AccessControlPage').then(module => ({ default: module.AccessControlPage })))
const ResultsPage = lazy(() => import('@/features/results/ResultsPage').then(module => ({ default: module.ResultsPage })))
const SharedResultPage = lazy(() => import('@/features/results/SharedResultPage').then(module => ({ default: module.SharedResultPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="Axentra@Zuanshi-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
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
