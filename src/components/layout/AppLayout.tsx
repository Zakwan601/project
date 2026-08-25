import { Outlet, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { Separator } from '@/components/ui/separator'
import { ModeToggle } from '@/components/mode-toggle'
import { Spinner } from '@/components/ui/spinner'
import { useLocation } from 'react-router-dom'
import { isProfileComplete } from '@/lib/profile'
import { PwaControls } from '@/components/shared/PwaControls'
import { ZktecoNavbarStatus } from '@/components/shared/ZktecoDeviceStatus'
import type { PermissionKey } from '@/types/database'

const permissionRoutes: Array<{ path: string; permission: PermissionKey }> = [
  { path: '/dashboard', permission: 'dashboard' },
  { path: '/students', permission: 'students' },
  { path: '/classes', permission: 'classes' },
  { path: '/attendance', permission: 'attendance' },
  { path: '/punches', permission: 'punches' },
  { path: '/reports', permission: 'reports' },
  { path: '/results', permission: 'results' },
  { path: '/complaints', permission: 'complaints' },
  { path: '/announcements', permission: 'announcements' },
  { path: '/vacations', permission: 'vacations' },
  { path: '/departure-anomalies', permission: 'departure_anomalies' },
  { path: '/devices', permission: 'devices' },
  { path: '/sms-messages', permission: 'sms_messages' },
]

const pageLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/students': 'Students',
  '/classes': 'Classes',
  '/attendance': 'Attendance',
  '/punches': 'Punches',
  '/reports': 'Reports',
  '/results': 'Student Results',
  '/complaints': 'Complaints',
  '/announcements': 'Announcements',
  '/vacations': 'Vacations',
  '/report-issue': 'Report an Issue',
  '/devices': 'Devices',
  '/settings': 'Settings',
  '/access-control': 'Access Control',
  '/profile': 'Profile',
}

export function AppLayout() {
  const { session, profile, student, loading, can } = useAuth()
  const location = useLocation()

  if (!session) {
    return loading ? (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    ) : <Navigate to="/login" replace />
  }

  if ((loading || !isProfileComplete(profile, student)) && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />
  }

  const requestedModule = permissionRoutes.find(item => location.pathname.startsWith(item.path))
  const firstAllowedPath = permissionRoutes.find(item => can(item.permission))?.path ?? '/profile'
  const requiresFullAdmin = location.pathname.startsWith('/settings')
    || location.pathname.startsWith('/access-control')

  if (requiresFullAdmin && profile?.role !== 'admin') {
    return <Navigate to={profile?.role === 'sub_admin' ? firstAllowedPath : '/dashboard'} replace />
  }

  if (profile?.role === 'sub_admin') {
    if (requestedModule && !can(requestedModule.permission)) {
      return <Navigate to={firstAllowedPath} replace />
    }
  }

  if (profile?.role === 'student'
      && requestedModule
      && requestedModule.path !== '/dashboard'
      && requestedModule.path !== '/attendance'
      && requestedModule.path !== '/punches'
      && requestedModule.path !== '/results') {
    return <Navigate to={'/dashboard'} replace />
  }

  const pageTitle = Object.entries(pageLabels).find(([key]) =>
    location.pathname.startsWith(key)
  )?.[1] ?? 'Axentra@Zuanshi'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-sm font-semibold flex-1">{pageTitle}</h1>
          <ZktecoNavbarStatus />
          <PwaControls />
          <ModeToggle />
        </header>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="min-w-0 flex-1 p-3 sm:p-6"
        >
          <Outlet />
        </motion.main>
      </SidebarInset>
    </SidebarProvider>
  )
}
