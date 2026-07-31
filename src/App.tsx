import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { StudentsPage } from '@/features/students/StudentsPage'
import { ClassesPage } from '@/features/classes/ClassesPage'
import { AttendancePage } from '@/features/attendance/AttendancePage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { DevicesPage } from '@/features/devices/DevicesPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { RecentPunchesPage } from '@/features/punches/RecentPunchesPage'
import { StudentReportsPage } from '@/features/reports/StudentReportsPage'
import { ComplaintsPage } from '@/features/reports/ComplaintsPage'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="eduattend-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />

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
                <Route
                  path="/complaints"
                  element={(
                    <ProtectedRoute roles={['admin']}>
                      <ComplaintsPage />
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
              </Route>

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
