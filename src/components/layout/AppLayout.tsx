import { Outlet, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { Separator } from '@/components/ui/separator'
import { ModeToggle } from '@/components/mode-toggle'
import { Spinner } from '@/components/ui/spinner'
import { useLocation } from 'react-router-dom'

const pageLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/students': 'Students',
  '/classes': 'Classes',
  '/attendance': 'Attendance',
  '/punches': 'Recent Punches',
  '/reports': 'Reports',
  '/devices': 'Devices',
  '/settings': 'Settings',
  '/profile': 'Profile',
}

export function AppLayout() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  const pageTitle = Object.entries(pageLabels).find(([key]) =>
    location.pathname.startsWith(key)
  )?.[1] ?? 'EduAttend'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-sm font-semibold flex-1">{pageTitle}</h1>
          <ModeToggle />
        </header>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex-1 p-6"
        >
          <Outlet />
        </motion.main>
      </SidebarInset>
    </SidebarProvider>
  )
}
