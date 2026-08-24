import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { permissionDefinitions } from '@/lib/permissions'
import type { PermissionKey, Profile, SubAdminPermission } from '@/types/database'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Database RPC types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

type PermissionState = Record<PermissionKey, { read: boolean; write: boolean }>

interface CreatedCredentials {
  name: string
  email: string
  password: string
}

const emptyPermissionState = () => Object.fromEntries(
  permissionDefinitions.map(item => [item.key, { read: false, write: false }]),
) as PermissionState

export function AccessControlPage() {
  const queryClient = useQueryClient()
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [permissions, setPermissions] = useState<PermissionState>(emptyPermissionState)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(() => generateTemporaryPassword())
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null)

  const profilesQuery = useQuery({
    queryKey: ['sub-admin-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'sub_admin')
        .order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const permissionsQuery = useQuery({
    queryKey: ['sub-admin-permissions', selectedProfileId],
    enabled: Boolean(selectedProfileId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sub_admin_permissions')
        .select('*')
        .eq('profile_id', selectedProfileId)
      if (error) throw error
      return data as SubAdminPermission[]
    },
  })

  useEffect(() => {
    const next = emptyPermissionState()
    for (const grant of permissionsQuery.data ?? []) {
      next[grant.permission_key] = { read: grant.can_read, write: grant.can_write }
    }
    setPermissions(next)
  }, [permissionsQuery.data, selectedProfileId])

  const createSubAdmin = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          role: 'sub_admin',
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      return data as { profile_id: string }
    },
    onSuccess: async data => {
      setCreatedCredentials({ name: fullName.trim(), email: email.trim(), password })
      setFullName('')
      setEmail('')
      setPassword(generateTemporaryPassword())
      await queryClient.invalidateQueries({ queryKey: ['sub-admin-profiles'] })
      setSelectedProfileId(data.profile_id)
      toast.success('Sub-admin account created')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const savePermissions = useMutation({
    mutationFn: async () => {
      const permissionRows = permissionDefinitions.map(item => ({
        permission_key: item.key,
        can_read: permissions[item.key].read,
        can_write: item.supportsWrite && permissions[item.key].write,
      }))
      const { error } = await db.rpc('set_sub_admin_permissions', {
        p_profile_id: selectedProfileId,
        p_permissions: permissionRows,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sub-admin-permissions', selectedProfileId] })
      toast.success('Permissions saved')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="max-w-4xl space-y-4 sm:space-y-6">
      <PageHeader
        title="Access Control"
        description="Create sub-admin accounts and assign module-level read or write access."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Plus /> Create Sub-admin</CardTitle>
          <CardDescription>All other accounts remain normal students unless an administrator elevates them.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={event => {
              event.preventDefault()
              createSubAdmin.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="sub-admin-name">Full name</Label>
              <Input id="sub-admin-name" value={fullName} onChange={event => setFullName(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-admin-email">Email</Label>
              <Input id="sub-admin-email" type="email" value={email} onChange={event => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sub-admin-password">Temporary password</Label>
              <div className="flex gap-2">
                <Input id="sub-admin-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required />
                <Button type="button" variant="outline" onClick={() => setPassword(generateTemporaryPassword())}>
                  <KeyRound /> Generate
                </Button>
              </div>
            </div>
            <Button type="submit" className="sm:col-span-2 sm:w-fit" disabled={createSubAdmin.isPending || password.length < 8}>
              {createSubAdmin.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Create Sub-admin
            </Button>
          </form>

          {createdCredentials && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p className="font-semibold">Save and share these credentials securely</p>
              <p className="mt-1">Name: {createdCredentials.name}</p>
              <p>Email: <span className="font-mono">{createdCredentials.email}</span></p>
              <p>Password: <span className="font-mono">{createdCredentials.password}</span></p>
              <p className="mt-1 text-xs text-muted-foreground">The password will not be displayed again.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub-admin Permissions</CardTitle>
          <CardDescription>Write access automatically includes read access.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Sub-admin</Label>
            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
              <SelectTrigger><SelectValue placeholder={profilesQuery.isLoading ? 'Loading accounts...' : 'Select a sub-admin'} /></SelectTrigger>
              <SelectContent>
                {(profilesQuery.data ?? []).map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>{profile.full_name || 'Unnamed account'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProfileId && (
            <>
              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold">
                  <span>Module</span><span className="text-center">Read</span><span className="text-center">Write</span>
                </div>
                {permissionDefinitions.map(item => (
                  <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-2 border-b px-3 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={permissions[item.key].read}
                        onCheckedChange={checked => setPermissions(current => ({
                          ...current,
                          [item.key]: { read: checked === true, write: checked === true ? current[item.key].write : false },
                        }))}
                        aria-label={`Allow ${item.label} read access`}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={permissions[item.key].write}
                        disabled={!item.supportsWrite}
                        onCheckedChange={checked => setPermissions(current => ({
                          ...current,
                          [item.key]: { read: checked === true || current[item.key].read, write: checked === true },
                        }))}
                        aria-label={`Allow ${item.label} write access`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => savePermissions.mutate()} disabled={savePermissions.isPending || permissionsQuery.isLoading}>
                  {savePermissions.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                  Save Permissions
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return `Ax!${Array.from(bytes, value => (value % 36).toString(36)).join('')}9`
}
