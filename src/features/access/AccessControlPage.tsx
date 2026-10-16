import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, ChevronRight, Copy, Eye, EyeOff, KeyRound, Loader2, Mail, Phone, Plus, RotateCcw, Save, Search, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { permissionDefinitions } from '@/lib/permissions'
import { formatDisplayDate } from '@/lib/dateTime'
import { getSubAdminLabel } from '@/lib/subAdminLabel'
import { generateTemporaryPassword, SubAdminLoginDialog } from '@/features/access/SubAdminLoginDialog'
import type { PermissionKey, Profile, SubAdminLabel, SubAdminPermission } from '@/types/database'
import { PageHeader } from '@/components/shared/PageHeader'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

// Database RPC types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type PermissionState = Record<PermissionKey, { read: boolean; write: boolean }>

type SubAdminAccount = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'phone' | 'secondary_phone' | 'is_active' | 'created_at' | 'sub_admin_label'> & {
  login_email: string | null
}

interface CreatedCredentials {
  name: string
  email: string
  password: string
  label: SubAdminLabel
}

const emptyPermissionState = () => Object.fromEntries(
  permissionDefinitions.map(item => [item.key, { read: false, write: false }]),
) as PermissionState

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'SA'
}

function permissionCounts(state: PermissionState) {
  return {
    viewOnly: permissionDefinitions.filter(item => state[item.key].read && !state[item.key].write).length,
    editable: permissionDefinitions.filter(item => state[item.key].write).length,
    accessible: permissionDefinitions.filter(item => state[item.key].read).length,
  }
}

export function AccessControlPage() {
  const queryClient = useQueryClient()
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<{ profileId: string; permissions: PermissionState } | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [accountLabel, setAccountLabel] = useState<SubAdminLabel>('sub_admin')
  const [password, setPassword] = useState(() => generateTemporaryPassword())
  const [showPassword, setShowPassword] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null)
  const [loginAccount, setLoginAccount] = useState<SubAdminAccount | null>(null)

  const profilesQuery = useQuery({
    queryKey: ['sub-admin-profiles'],
    queryFn: async () => {
      const { data, error } = await db.rpc('list_sub_admin_accounts')
      if (error) throw error
      return data as SubAdminAccount[]
    },
  })
  const permissionsQuery = useQuery({
    queryKey: ['sub-admin-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_admin_permissions').select('*')
      if (error) throw error
      return data as SubAdminPermission[]
    },
  })
  const profiles = profilesQuery.data ?? []
  const permissionsByProfile = useMemo(() => {
    const result = new Map<string, PermissionState>()
    for (const grant of permissionsQuery.data ?? []) {
      if (!permissionDefinitions.some(item => item.key === grant.permission_key)) continue
      const state = result.get(grant.profile_id) ?? emptyPermissionState()
      state[grant.permission_key] = { read: grant.can_read || grant.can_write, write: grant.can_write }
      result.set(grant.profile_id, state)
    }
    return result
  }, [permissionsQuery.data])
  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId)
  const savedPermissions = permissionsByProfile.get(selectedProfileId) ?? emptyPermissionState()
  const permissions = draft?.profileId === selectedProfileId ? draft.permissions : savedPermissions
  const hasChanges = permissionDefinitions.some(item =>
    permissions[item.key].read !== savedPermissions[item.key].read
    || permissions[item.key].write !== savedPermissions[item.key].write,
  )
  const counts = permissionCounts(permissions)
  const filteredProfiles = profiles.filter(profile =>
    !search.trim() || [profile.full_name, profile.login_email, profile.phone, profile.secondary_phone].some(value =>
      value?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  const activeCount = profiles.filter(profile => profile.is_active).length
  const noAccessCount = profiles.filter(profile =>
    permissionCounts(permissionsByProfile.get(profile.id) ?? emptyPermissionState()).accessible === 0,
  ).length
  const grants = (permissionsQuery.data ?? []).filter(grant => grant.profile_id === selectedProfileId)
  const latestGrantUpdate = grants.map(grant => grant.updated_at).sort().at(-1)
  const permissionsUnavailable = permissionsQuery.isPending || permissionsQuery.isError

  // Keep initial selection predictable without changing a user's current selection.
  useEffect(() => {
    if (!selectedProfileId && profilesQuery.data?.length) setSelectedProfileId(profilesQuery.data[0].id)
  }, [profilesQuery.data, selectedProfileId])

  const createSubAdmin = useMutation({
    mutationFn: async (account: CreatedCredentials) => {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { email: account.email, password: account.password, full_name: account.name, role: 'sub_admin', sub_admin_label: account.label },
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      return data as { profile_id: string }
    },
    onSuccess: async (data, account) => {
      setCreatedCredentials(account)
      setFullName('')
      setEmail('')
      setAccountLabel('sub_admin')
      setPassword(generateTemporaryPassword())
      setShowPassword(false)
      setDraft(null)
      setSearch('')
      setSelectedProfileId(data.profile_id)
      await queryClient.invalidateQueries({ queryKey: ['sub-admin-profiles'] })
      toast.success(`${getSubAdminLabel(account.label)} account created. Choose their permissions next.`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const savePermissions = useMutation({
    mutationFn: async ({ profileId, values }: { profileId: string; values: PermissionState }) => {
      const permissionRows = permissionDefinitions.map(item => ({
        permission_key: item.key, can_read: values[item.key].read,
        can_write: item.supportsWrite && values[item.key].write,
      }))
      const { error } = await db.rpc('set_sub_admin_permissions', {
        p_profile_id: profileId, p_permissions: permissionRows,
      })
      if (error) throw error
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['sub-admin-permissions'] })
      setDraft(current => current?.profileId === variables.profileId ? null : current)
      toast.success('Permissions saved')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const updateLabel = useMutation({
    mutationFn: async ({ profileId, label }: { profileId: string; label: SubAdminLabel }) => {
      const { error } = await db.rpc('set_sub_admin_label', { p_profile_id: profileId, p_label: label })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sub-admin-profiles'] })
      toast.success('Display label updated')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const editingDisabled = permissionsUnavailable || savePermissions.isPending

  const chooseProfile = (profileId: string) => {
    if (profileId === selectedProfileId || savePermissions.isPending) return
    if (hasChanges && !window.confirm('Discard unsaved permission changes and switch accounts?')) return
    setDraft(null)
    setSelectedProfileId(profileId)
  }
  const setPermission = (key: PermissionKey, access: 'read' | 'write', checked: boolean) => {
    setDraft({ profileId: selectedProfileId, permissions: {
      ...permissions,
      [key]: access === 'read'
        ? { read: checked, write: checked && permissions[key].write }
        : { read: checked || permissions[key].read, write: checked },
    } })
  }
  const copyCredentials = async () => {
    if (!createdCredentials) return
    try {
      await navigator.clipboard.writeText(`Name: ${createdCredentials.name}\nEmail: ${createdCredentials.email}\nTemporary password: ${createdCredentials.password}`)
      toast.success('Credentials copied')
    } catch {
      toast.error('Could not copy. Please copy the credentials manually.')
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title="Access Control" description="Your team, with the right access to the right tools."
        action={<Button className="w-full sm:w-auto" disabled={savePermissions.isPending} onClick={() => {
          if (hasChanges && !window.confirm('Discard unsaved permission changes before creating an account?')) return
          setDraft(null)
          setCreatedCredentials(null)
          setCreateDialogOpen(true)
        }}><Plus className="h-4 w-4" /> Add sub-admin</Button>} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-5 text-sm">
        {[
          { label: 'Team members', value: profilesQuery.isPending ? null : profiles.length, icon: Users },
          { label: 'Active accounts', value: profilesQuery.isPending ? null : activeCount, icon: CheckCircle2 },
          { label: 'No module access', value: profilesQuery.isPending || permissionsUnavailable ? null : noAccessCount, icon: KeyRound },
        ].map(stat => (
          <div key={stat.label} className="flex items-center gap-2.5">
            <stat.icon className="h-4 w-4 text-muted-foreground" />
            {stat.value == null ? <Skeleton className="h-5 w-5" /> : <span className="font-semibold tabular-nums">{stat.value}</span>}
            <span className="text-xs text-muted-foreground sm:text-sm">{stat.label}</span>
          </div>
        ))}
      </div>

      {profilesQuery.isError ? (
        <div className="rounded-xl border p-6 text-center">
          <p className="font-medium">Accounts could not be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">{(profilesQuery.error as Error).message}</p>
          <Button className="mt-4" variant="outline" onClick={() => void profilesQuery.refetch()}>Try again</Button>
        </div>
      ) : !profilesQuery.isPending && profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Users className="h-6 w-6 text-primary" /></div>
          <h3 className="text-lg font-semibold">Build your school team</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Create a sub-admin account, then choose which school tools they can view or edit.</p>
          <Button className="mt-5" onClick={() => { setCreatedCredentials(null); setCreateDialogOpen(true) }}><Plus className="h-4 w-4" /> Create your first sub-admin</Button>
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-3 lg:sticky lg:top-20">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Sub-admins</h3><span className="text-xs text-muted-foreground">{profiles.length} accounts</span></div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Search sub-admins" placeholder="Search name, email or phone..." value={search} onChange={event => setSearch(event.target.value)} className="pl-9" />
            </div>
            <div className="lg:hidden">
              <Select value={selectedProfileId} onValueChange={chooseProfile} disabled={savePermissions.isPending}>
                <SelectTrigger className="w-full" aria-label="Select a sub-admin"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>{filteredProfiles.map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.full_name || 'Unnamed account'}{!profile.is_active ? ' (Inactive)' : ''}</SelectItem>)}</SelectContent>
              </Select>
              {!filteredProfiles.length && !profilesQuery.isPending && <p className="mt-2 text-xs text-muted-foreground">No accounts match your search.</p>}
            </div>
            <div className="hidden max-h-[65vh] space-y-1 overflow-y-auto rounded-xl border p-1.5 lg:block">
              {profilesQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-20 w-full" />) : filteredProfiles.map(profile => {
                const active = profile.id === selectedProfileId
                return (
                  <button key={profile.id} type="button" aria-pressed={active} disabled={savePermissions.isPending} onClick={() => chooseProfile(profile.id)}
                    className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60'}`}>
                    <div className="relative shrink-0"><Avatar className="h-9 w-9"><AvatarImage src={profile.avatar_url ?? undefined} alt="" /><AvatarFallback className={active ? 'bg-primary/15 text-primary' : ''}>{initials(profile.full_name ?? '')}</AvatarFallback></Avatar><span aria-label={profile.is_active ? 'Active' : 'Inactive'} className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background ${profile.is_active ? 'bg-emerald-500' : 'bg-muted-foreground'}`} /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{profile.full_name || 'Unnamed account'}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={profile.login_email ?? undefined}>{profile.login_email || 'No login email available'}</p></div>
                    {active && <ChevronRight className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                )
              })}
              {!filteredProfiles.length && !profilesQuery.isPending && <p className="p-6 text-center text-sm text-muted-foreground">No matching accounts.</p>}
            </div>
            <p className="hidden px-1 text-xs leading-relaxed text-muted-foreground lg:block">Choose an account to review its details and manage access. Changes take effect after saving.</p>
          </aside>

          {selectedProfile ? (
            <section className="min-w-0 overflow-hidden rounded-xl border">
              <div className="border-b bg-gradient-to-br from-primary/5 via-background to-background p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <Avatar className="h-12 w-12 shrink-0 sm:h-14 sm:w-14"><AvatarImage src={selectedProfile.avatar_url ?? undefined} alt="" /><AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">{initials(selectedProfile.full_name ?? '')}</AvatarFallback></Avatar>
                    <div className="min-w-0"><p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{getSubAdminLabel(selectedProfile.sub_admin_label)}</p><h3 className="break-words text-lg font-semibold sm:text-xl">{selectedProfile.full_name || 'Unnamed account'}</h3></div>
                  </div>
                  <Badge variant="outline" className={selectedProfile.is_active ? 'gap-1.5 border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'gap-1.5 text-muted-foreground'}><span className={`h-1.5 w-1.5 rounded-full ${selectedProfile.is_active ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />{selectedProfile.is_active ? 'Active account' : 'Inactive account'}</Badge>
                </div>
                <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-xs">
                  <div className="min-w-0 basis-full"><dt className="flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Login email</dt><dd className="mt-1 break-all font-medium">{selectedProfile.login_email || 'No login email available'}</dd></div>
                  <div><dt className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Created</dt><dd className="mt-1 font-medium">{formatDisplayDate(selectedProfile.created_at)}</dd></div>
                  <div><dt className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> Contact</dt><dd className="mt-1 font-medium">{selectedProfile.phone || selectedProfile.secondary_phone || 'Not provided'}</dd></div>
                  <div><dt className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Latest grant update</dt><dd className="mt-1 font-medium">{permissionsUnavailable ? 'Unavailable' : latestGrantUpdate ? formatDisplayDate(latestGrantUpdate) : 'No module grants'}</dd></div>
                </dl>
                <div className="mt-4 max-w-xs space-y-1.5">
                  <Label htmlFor="staff-display-label">Display as</Label>
                  <Select value={updateLabel.isPending && updateLabel.variables?.profileId === selectedProfileId ? updateLabel.variables.label : selectedProfile.sub_admin_label ?? 'sub_admin'} disabled={updateLabel.isPending} onValueChange={value => {
                    if (value !== selectedProfile.sub_admin_label) updateLabel.mutate({ profileId: selectedProfileId, label: value as SubAdminLabel })
                  }}>
                    <SelectTrigger id="staff-display-label" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="sub_admin">Sub-administrator</SelectItem><SelectItem value="teacher">Teacher</SelectItem></SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Display label only. Permissions stay the same.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-4" disabled={!selectedProfile.login_email} onClick={() => setLoginAccount(selectedProfile)}><KeyRound className="h-3.5 w-3.5" /> Login details</Button>
                {!selectedProfile.is_active && <p className="mt-4 text-xs text-muted-foreground">This account is inactive. Assigned permissions do not grant access while it remains inactive.</p>}
              </div>

              <div className="p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h4 className="font-semibold">Permissions</h4><p className="mt-1 text-xs text-muted-foreground">Write access includes Read.</p></div>
                  {!permissionsUnavailable && <Badge variant={hasChanges ? 'outline' : 'secondary'} className={hasChanges ? 'border-amber-500/30 text-amber-700 dark:text-amber-400' : ''}>{hasChanges ? 'Unsaved changes' : counts.accessible ? 'Saved access' : 'No access assigned'}</Badge>}
                </div>

                {permissionsQuery.isPending ? <div className="mt-5 space-y-3" role="status" aria-label="Loading permissions">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
                  : permissionsQuery.isError ? <div className="mt-5 rounded-lg border border-destructive/20 p-4"><p className="text-sm text-destructive">Permissions could not be loaded.</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void permissionsQuery.refetch()}>Try again</Button></div>
                    : <div className="mt-4 divide-y border-y">
                          <div className="grid grid-cols-[minmax(0,1fr)_48px_48px] gap-2 bg-muted/30 px-1 py-2 text-xs font-semibold sm:grid-cols-[minmax(0,1fr)_64px_64px]">
                            <span>Permission</span><span className="text-center">Read</span><span className="text-center">Write</span>
                          </div>
                          {permissionDefinitions.map(item => {
                            const key = item.key
                            return <div key={key} className="grid grid-cols-[minmax(0,1fr)_48px_48px] items-center gap-2 px-1 py-1 sm:grid-cols-[minmax(0,1fr)_64px_64px]">
                              <p className="min-w-0 text-sm font-medium">{item.label}</p>
                              <div className="flex min-h-10 items-center justify-center">
                                <Checkbox checked={permissions[key].read} disabled={editingDisabled}
                                  onCheckedChange={checked => setPermission(key, 'read', checked === true)}
                                  aria-label={`Allow ${item.label} read access`} />
                              </div>
                              <div className="flex min-h-10 items-center justify-center">
                                <Checkbox checked={permissions[key].write} disabled={editingDisabled || !item.supportsWrite}
                                  onCheckedChange={checked => setPermission(key, 'write', checked === true)}
                                  aria-label={`Allow ${item.label} write access`} />
                              </div>
                            </div>
                          })}
                    </div>}
              </div>

              <footer className="flex flex-col gap-3 border-t bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs text-muted-foreground" aria-live="polite">{savePermissions.isPending ? 'Saving permission changes...' : hasChanges ? 'Review your changes, then save to apply them.' : permissionsUnavailable ? 'Load permissions to review this account.' : 'Permissions are up to date.'}</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" disabled={!hasChanges || savePermissions.isPending} onClick={() => setDraft(null)}><RotateCcw className="h-3.5 w-3.5" /> Discard</Button>
                  <Button type="button" size="sm" disabled={!hasChanges || editingDisabled} onClick={() => savePermissions.mutate({ profileId: selectedProfileId, values: permissions })}>
                    {savePermissions.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save permissions
                  </Button>
                </div>
              </footer>
            </section>
          ) : <div className="space-y-4 rounded-xl border p-6" role="status" aria-label="Loading sub-admin details"><Skeleton className="h-16 w-2/3" />{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>}
        </div>
      )}

      {loginAccount && <SubAdminLoginDialog key={loginAccount.id} account={loginAccount} onClose={() => setLoginAccount(null)} />}

      <Dialog open={createDialogOpen} onOpenChange={open => {
        if (createSubAdmin.isPending) return
        setCreateDialogOpen(open)
        if (!open) { setCreatedCredentials(null); setShowPassword(false) }
      }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!createSubAdmin.isPending}>
          <DialogHeader><div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><ShieldCheck className="h-5 w-5 text-primary" /></div><DialogTitle>{createdCredentials ? 'Your new team member is ready' : 'Add a sub-admin'}</DialogTitle><DialogDescription>{createdCredentials ? 'Save the login details securely, then configure module access for this account.' : 'Create a staff login. The account starts without module access until you assign permissions.'}</DialogDescription></DialogHeader>
          {createdCredentials ? <div className="space-y-4">
            <dl className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">Name</dt><dd className="mt-1 break-words font-medium">{createdCredentials.name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Login email</dt><dd className="mt-1 break-all font-medium">{createdCredentials.email}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Temporary password</dt><dd className="mt-1 break-all font-mono">{createdCredentials.password}</dd></div>
            </dl>
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><KeyRound className="h-4 w-4 shrink-0" />These credentials are only shown during creation. Keep them secure before closing this window.</p>
            <DialogFooter><Button variant="outline" onClick={() => void copyCredentials()}><Copy className="h-4 w-4" /> Copy credentials</Button><Button onClick={() => { setCreatedCredentials(null); setCreateDialogOpen(false) }}>Set permissions <ChevronRight className="h-4 w-4" /></Button></DialogFooter>
          </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); createSubAdmin.mutate({ name: fullName.trim(), email: email.trim(), password, label: accountLabel }) }}>
            <fieldset className="space-y-4" disabled={createSubAdmin.isPending}>
              <div className="space-y-1.5"><Label htmlFor="sub-admin-name">Full name</Label><Input id="sub-admin-name" value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" placeholder="e.g. Rahim Ahmed" required /></div>
              <div className="space-y-1.5"><Label htmlFor="sub-admin-email">Login email</Label><Input id="sub-admin-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" placeholder="name@example.com" required /></div>
              <div className="space-y-1.5">
                <Label htmlFor="new-staff-display-label">Display as</Label>
                <Select value={accountLabel} onValueChange={value => setAccountLabel(value as SubAdminLabel)} disabled={createSubAdmin.isPending}>
                  <SelectTrigger id="new-staff-display-label" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="sub_admin">Sub-administrator</SelectItem><SelectItem value="teacher">Teacher</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="sub-admin-password">Temporary password</Label><div className="flex gap-2"><div className="relative min-w-0 flex-1"><Input id="sub-admin-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required className="pr-10" /><Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div><Button type="button" variant="outline" size="icon" aria-label="Generate a temporary password" onClick={() => setPassword(generateTemporaryPassword())}><KeyRound className="h-4 w-4" /></Button></div><p className="text-xs text-muted-foreground">At least 8 characters. Share it securely with the account holder.</p></div>
            </fieldset>
            <DialogFooter><Button type="button" variant="outline" disabled={createSubAdmin.isPending} onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={createSubAdmin.isPending || password.length < 8 || !fullName.trim() || !email.trim()}>{createSubAdmin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{createSubAdmin.isPending ? 'Creating account...' : 'Create account'}</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
