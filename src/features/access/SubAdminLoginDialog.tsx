import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { getSubAdminLabel } from '@/lib/subAdminLabel'
import type { SubAdminLabel } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginAccount {
  id: string
  full_name: string
  login_email: string | null
  sub_admin_label: SubAdminLabel
}

export function SubAdminLoginDialog({ account, onClose }: { account: LoginAccount; onClose: () => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const resetPassword = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      const password = generateTemporaryPassword()
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { action: 'reset-sub-admin-password', profile_id: account.id, password },
      })
      if (error) {
        if (error.context instanceof Response) {
          const details = await error.context.json().catch(() => null)
          throw new Error(details?.error || error.message)
        }
        throw error
      }
      if (data?.error) throw new Error(String(data.error))
      return { password, email: (data?.email as string | undefined) || account.login_email || '' }
    },
    onSuccess: () => {
      setShowPassword(true)
      toast.success('A new temporary password is ready to share')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const email = resetPassword.data?.email ?? account.login_email ?? ''
  const password = resetPassword.data?.password
  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !resetPassword.isPending) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!resetPassword.isPending}>
        <DialogHeader>
          <DialogTitle>{getSubAdminLabel(account.sub_admin_label)} login</DialogTitle>
          <DialogDescription>{account.full_name || 'Sub-admin account'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="sub-admin-login-email">Login email</Label>
            <div className="flex gap-2">
              <Input id="sub-admin-login-email" type="email" readOnly value={email} placeholder="No login email available" />
              <Button type="button" variant="outline" size="icon" disabled={!email} aria-label="Copy login email" onClick={() => void copyText(email, 'Email')}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
          {password ? <>
            <div className="space-y-2">
              <Label htmlFor="sub-admin-new-password">New temporary password</Label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input id="sub-admin-new-password" type={showPassword ? 'text' : 'password'} readOnly value={password} className="pr-10 font-mono" autoComplete="off" />
                  <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                </div>
                <Button type="button" variant="outline" size="icon" aria-label="Copy temporary password" onClick={() => void copyText(password, 'Password')}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={() => void copyText(`${getSubAdminLabel(account.sub_admin_label)} login\nName: ${account.full_name}\nEmail: ${email}\nPassword: ${password}\n\nPlease change the password after signing in.`, 'Login message')}><Copy className="h-4 w-4" /> Copy login message</Button>
          </> : <>
            <p className="text-sm text-muted-foreground">Generate a new temporary password when this account needs help signing in. This replaces its current password immediately.</p>
            <Button type="button" variant="outline" className="w-full" disabled={resetPassword.isPending || !email} onClick={() => resetPassword.mutate()}>
              {resetPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {resetPassword.isPending ? 'Generating...' : 'Generate new temporary password'}
            </Button>
          </>}
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><KeyRound className="h-4 w-4 shrink-0" />Passwords are not stored or displayed again. The login email stays available, and an administrator can issue a fresh temporary password at any time.</p>
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={resetPassword.isPending} onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function generateTemporaryPassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%']
  const all = groups.join('')
  const random = (characters: string) => characters[crypto.getRandomValues(new Uint32Array(1))[0] % characters.length]
  const chars = groups.map(random)
  while (chars.length < 12) chars.push(random(all))
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1)
    ;[chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]]
  }
  return chars.join('')
}
