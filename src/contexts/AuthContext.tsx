import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { PermissionKey, Profile, Student, SubAdminPermission, UserRole } from '@/types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  student: Student | null
  role: UserRole | null
  permissions: SubAdminPermission[]
  can: (permission: PermissionKey, access?: 'read' | 'write') => boolean
  loading: boolean
  profileError: string | null
  signIn: (email: string, password: string, turnstileToken: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

interface ProfileLoad {
  userId: string
  promise: Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const [permissions, setPermissions] = useState<SubAdminPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const profileLoadRef = useRef<ProfileLoad | null>(null)
  const loadedUserIdRef = useRef<string | null>(null)
  const activeUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback((userId: string) => {
    const currentLoad = profileLoadRef.current
    if (currentLoad?.userId === userId) return currentLoad.promise

    const load: ProfileLoad = { userId, promise: Promise.resolve() }
    load.promise = (async () => {
      let lastError: unknown
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const [
              { data: profileData, error: profileQueryError },
              { data: studentData, error: studentError },
              { data: permissionData, error: permissionError },
            ] = await Promise.all([
              supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
              supabase.from('students').select('*').eq('profile_id', userId).maybeSingle(),
              supabase.from('sub_admin_permissions').select('*').eq('profile_id', userId),
            ])
            if (profileQueryError) throw profileQueryError
            if (studentError) throw studentError
            if (permissionError) throw permissionError

            const loadedProfile = profileData as Profile | null
            const linkedStudent = studentData as Student | null
            if (!loadedProfile) throw new Error('Profile record not found')
            if (loadedProfile.role === 'student' && !linkedStudent) {
              throw new Error('Linked student record not found')
            }
            if (profileLoadRef.current !== load) return

            setProfile(loadedProfile)
            setStudent(linkedStudent)
            setPermissions((permissionData ?? []) as SubAdminPermission[])
            loadedUserIdRef.current = userId
            return
          } catch (error) {
            lastError = error
            if (profileLoadRef.current !== load) return
            if (attempt < 2) {
              await new Promise(resolve => window.setTimeout(resolve, 400 * (attempt + 1)))
            }
          }
        }
        throw lastError instanceof Error ? lastError : new Error('Profile loading failed')
      } finally {
        if (profileLoadRef.current === load) profileLoadRef.current = null
      }
    })()
    profileLoadRef.current = load
    return load.promise
  }, [])

  const hydrateProfile = useCallback(async (userId: string) => {
    setLoading(true)
    setProfileError(null)
    try {
      await fetchProfile(userId)
    } catch (error) {
      if (activeUserIdRef.current === userId) {
        loadedUserIdRef.current = null
        setProfile(null)
        setStudent(null)
        setPermissions([])
        setProfileError(error instanceof Error ? error.message : 'Profile loading failed')
      }
      throw error
    } finally {
      if (activeUserIdRef.current === userId) setLoading(false)
    }
  }, [fetchProfile])

  const refreshProfile = useCallback(async () => {
    if (user) await hydrateProfile(user.id)
  }, [hydrateProfile, user])

  useEffect(() => {
    const deferredProfileLoads = new Set<number>()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUser = nextSession?.user ?? null
      const nextUserId = nextUser?.id ?? null
      activeUserIdRef.current = nextUserId
      setSession(nextSession)
      setUser(nextUser)

      if (!nextUserId) {
        profileLoadRef.current = null
        loadedUserIdRef.current = null
        setProfile(null)
        setStudent(null)
        setPermissions([])
        setProfileError(null)
        setLoading(false)
        return
      }

      const needsProfile = loadedUserIdRef.current !== nextUserId || event === 'USER_UPDATED'
      if (!needsProfile) {
        setLoading(false)
        return
      }

      setLoading(true)
      const timeoutId = window.setTimeout(() => {
        deferredProfileLoads.delete(timeoutId)
        if (activeUserIdRef.current === nextUserId) {
          void hydrateProfile(nextUserId).catch(() => undefined)
        }
      }, 0)
      deferredProfileLoads.add(timeoutId)
    })

    return () => {
      for (const timeoutId of deferredProfileLoads) window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [hydrateProfile])

  const signIn = async (email: string, password: string, turnstileToken: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: turnstileToken },
    })
    if (error) return { error: error as Error }
    if (!data.user || !data.session) return { error: new Error('Sign-in session was not created') }

    const userId = data.user.id
    activeUserIdRef.current = userId
    setSession(data.session)
    setUser(data.user)

    setLoading(true)
    setProfileError(null)
    void hydrateProfile(userId).catch(() => undefined)
    return { error: null }
  }

  const signUp = async (email: string, password: string, fullName: string, role: UserRole) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const can = useCallback((permission: PermissionKey, access: 'read' | 'write' = 'read') => {
    if (profile?.role === 'admin') return true
    if (profile?.role !== 'sub_admin') return false
    const grant = permissions.find(item => item.permission_key === permission)
    return access === 'write' ? Boolean(grant?.can_write) : Boolean(grant?.can_read)
  }, [permissions, profile?.role])

  return (
    <AuthContext.Provider value={{
      session, user, profile, student, role: profile?.role ?? null, permissions, can,
      loading, profileError, signIn, signUp, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
