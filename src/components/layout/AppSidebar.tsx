import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, BookOpen, ClipboardList,
  BarChart3, CalendarOff, Cpu, Settings, User, GraduationCap, LogOut, ScanLine, MessageSquareWarning, MessageSquareText, Megaphone, ShieldAlert, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useAdminUnreadComplaintCount } from '@/hooks/useStudentReports'
import { isProfileComplete } from '@/lib/profile'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  roles: UserRole[]
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'student'] },
  { title: 'Students', href: '/students', icon: Users, roles: ['admin'] },
  { title: 'Classes', href: '/classes', icon: BookOpen, roles: ['admin'] },
  { title: 'Attendance', href: '/attendance', icon: ClipboardList, roles: ['admin', 'student'] },
  { title: 'Punches', href: '/punches', icon: ScanLine, roles: ['admin', 'student'] },
  { title: 'Report Issue', href: '/report-issue', icon: MessageSquareWarning, roles: ['student'] },
  { title: 'Vacations', href: '/vacations', icon: CalendarOff, roles: ['admin'] },
  { title: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin'] },
]

const advancedNavItems: NavItem[] = [
  { title: 'Departure Anomalies', href: '/departure-anomalies', icon: ShieldAlert, roles: ['admin'] },
  { title: 'Devices', href: '/devices', icon: Cpu, roles: ['admin'] },
  { title: 'SMS Messages', href: '/sms-messages', icon: MessageSquareText, roles: ['admin'] },
  { title: 'Complaints', href: '/complaints', icon: MessageSquareWarning, roles: ['admin'] },
  { title: 'Announcements', href: '/announcements', icon: Megaphone, roles: ['admin'] },
  { title: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
]

const bottomNavItems: NavItem[] = [
  { title: 'Profile', href: '/profile', icon: User, roles: ['admin', 'student'] },
]

const roleColors: Record<UserRole, string> = {
  admin: 'bg-destructive text-destructive-foreground',
  student: 'bg-secondary text-secondary-foreground',
}

export function AppSidebar() {
  const { profile, student, role, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const profileComplete = isProfileComplete(profile, student)
  const { data: unreadComplaints = 0 } = useAdminUnreadComplaintCount(role === 'admin' && profileComplete)

  const filteredNav = profileComplete
    ? navItems.filter(item => role && item.roles.includes(role))
    : []
  const filteredAdvancedNav = profileComplete
    ? advancedNavItems.filter(item => role && item.roles.includes(role))
    : []
  const filteredBottom = bottomNavItems.filter(item =>
    role && item.roles.includes(role) && (profileComplete || item.href === '/profile')
  )
  const isAdvancedActive = filteredAdvancedNav.some(item => location.pathname.startsWith(item.href))
  const [advancedOpen, setAdvancedOpen] = useState(isAdvancedActive)

  useEffect(() => {
    if (isAdvancedActive) setAdvancedOpen(true)
  }, [isAdvancedActive])

  const accountName = role === 'student' && student
    ? `${student.first_name} ${student.last_name}`.trim()
    : profile?.full_name ?? 'User'
  const initials = accountName
    ? accountName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">Axentra@Zuanshi</span>
            <span className="text-xs text-muted-foreground">School Monitoring System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNav.map((item) => {
                const isActive = location.pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link to={item.href} onClick={closeMobileSidebar}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.href === '/complaints' && unreadComplaints > 0 && (
                      <SidebarMenuBadge>{unreadComplaints > 99 ? '99+' : unreadComplaints}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
              {filteredAdvancedNav.length > 0 && (
                <Collapsible asChild={true} open={advancedOpen} onOpenChange={setAdvancedOpen} className={'group/collapsible'}>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild={true}>
                      <SidebarMenuButton isActive={isAdvancedActive} tooltip={'Advanced Settings'}>
                        <Settings />
                        <span>Advanced Settings</span>
                        <ChevronRight className={'ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90'} />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {filteredAdvancedNav.map((item) => {
                          const isActive = location.pathname.startsWith(item.href)
                          return (
                            <SidebarMenuSubItem key={item.href}>
                              <SidebarMenuSubButton asChild={true} isActive={isActive}>
                                <Link to={item.href} onClick={closeMobileSidebar}>
                                  <item.icon />
                                  <span>{item.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                              {item.href === '/complaints' && unreadComplaints > 0 && (
                                <SidebarMenuBadge>{unreadComplaints > 99 ? '99+' : unreadComplaints}</SidebarMenuBadge>
                              )}
                            </SidebarMenuSubItem>
                          )
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredBottom.map((item) => {
                const isActive = location.pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link to={item.href} onClick={closeMobileSidebar}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Separator className="mb-2" />
        <div className="flex items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-medium truncate">{accountName}</span>
            {role && (
              <Badge variant="secondary" className={`text-xs w-fit mt-0.5 capitalize ${roleColors[role]}`}>
                {role}
              </Badge>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors group-data-[collapsible=icon]:hidden"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
