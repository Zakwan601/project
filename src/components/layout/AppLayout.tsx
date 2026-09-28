import { Suspense } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { Separator } from '@/components/ui/separator'
import { ModeToggle } from '@/components/mode-toggle'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
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
  '/archived-punches': 'Archived Punches',
  '/reports': 'Reports',
  '/results': 'Student Results',
  '/complaints': 'Complaints',
  '/announcements': 'Announcements',
  '/vacations': 'Vacations',
  '/report-issue': 'Report an Issue',
  '/departure-anomalies': 'Departure Anomalies',
  '/devices': 'Devices',
  '/sms-messages': 'SMS Messages',
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
    || location.pathname.startsWith('/archived-punches')
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
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-4 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-sm font-semibold flex-1">{pageTitle}</h1>
          <ZktecoNavbarStatus />
          <PwaControls />
          <ModeToggle />
        </header>
        <main
          className="min-w-0 flex-1 p-3 sm:p-6"
        >
          <Suspense fallback={<PageLoadingFallback pageTitle={pageTitle} pathname={location.pathname} />}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function PageLoadingFallback({ pageTitle, pathname }: { pageTitle: string; pathname: string }) {
  const isDashboard = pathname.startsWith('/dashboard')
  const isFormPage = pathname.startsWith('/profile') || pathname.startsWith('/settings')

  return (
    <section className="space-y-5" role="status" aria-label={`Loading ${pageTitle}`} aria-busy="true">
      <div className="flex min-h-10 items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pageTitle}</h2>
          <Skeleton className="mt-2 h-3 w-48 max-w-[60vw]" />
        </div>
        <Skeleton className="h-9 w-28 shrink-0" />
      </div>

      {isDashboard ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="min-h-24 rounded-lg border p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-4 h-7 w-16" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
            <ShellPanel rows={5} />
            <ShellPanel rows={4} />
          </div>
        </>
      ) : isFormPage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ShellPanel rows={6} />
          <ShellPanel rows={6} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-full sm:w-36" />
            <Skeleton className="h-9 w-full sm:w-28" />
          </div>
          <ShellTable />
        </>
      )}
      <span className="sr-only">Loading page content</span>
    </section>
  )
}

function ShellPanel({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border p-4">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-2 h-3 w-52 max-w-[70%]" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ShellTable() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(5rem,.6fr)_minmax(6rem,.7fr)] gap-4 border-b bg-muted/30 px-4 py-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="grid min-h-14 grid-cols-[minmax(0,1.6fr)_minmax(5rem,.6fr)_minmax(6rem,.7fr)] items-center gap-4 border-b px-4 last:border-b-0">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}
