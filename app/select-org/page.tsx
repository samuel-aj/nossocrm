'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Building2, Loader2, ChevronRight } from 'lucide-react'
import { UserRole } from '@/types/constants'
import { announceOrgSwitch, pinTabOrg } from '@/lib/tabOrg'

// /select-org NÃO está envolto pelo AuthProvider (que vive só em
// app/(protected)/layout.tsx e app/(admin)/admin/layout.tsx). Por isso
// não dá pra usar useAuth aqui — quebra o prerender no build.
// Para garantir que o menu reflita a org nova, usamos full reload
// (window.location.href), que reinicializa o AuthProvider no destino.

interface UserOrg {
  organization_id: string
  role: string
  organizations: { name: string } | null
}

export default function SelectOrgPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<UserOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!supabase) {
        router.push('/login')
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // Check if super_admin — they use the admin panel to switch
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role === UserRole.SUPER_ADMIN) {
        router.push('/dashboard')
        return
      }

      // Fetch user's organizations
      const { data: memberships } = await supabase
        .from('user_organizations')
        .select('organization_id, role, organizations(name)')
        .eq('user_id', user.id)

      const validOrgs = (memberships || []).filter(m => m.organizations).map(m => ({
        ...m,
        organizations: Array.isArray(m.organizations) ? m.organizations[0] : m.organizations,
      })) as UserOrg[]

      if (validOrgs.length === 0) {
        // No orgs — go to dashboard (will show empty state)
        router.push('/dashboard')
        return
      }

      if (validOrgs.length === 1) {
        // Single org — switch silently and go to dashboard (full reload p/ remontar AuthProvider).
        try {
          const res = await fetch('/api/switch-org', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ organizationId: validOrgs[0].organization_id }),
          })
          if (res.ok) {
            pinTabOrg(validOrgs[0].organization_id, validOrgs[0].organizations?.name)
            announceOrgSwitch(validOrgs[0].organization_id, validOrgs[0].organizations?.name)
          }
        } catch {
          // segue pro dashboard mesmo assim; o guard re-marca no load
        }
        window.location.href = '/dashboard'
        return
      }

      // Multiple orgs — show selection
      setOrgs(validOrgs)
      setLoading(false)
    }

    load()
  }, [router])

  const handleSelect = async (orgId: string) => {
    setSwitching(orgId)
    try {
      const res = await fetch('/api/switch-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: orgId }),
      })
      if (!res.ok) {
        setSwitching(null)
        return
      }
      const picked = orgs.find(o => o.organization_id === orgId)
      pinTabOrg(orgId, picked?.organizations?.name)
      announceOrgSwitch(orgId, picked?.organizations?.name)
      // Full reload p/ remontar AuthProvider com a org nova já no profile.
      window.location.href = '/dashboard'
    } catch {
      setSwitching(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="max-w-md w-full relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight mb-2">
            Selecione o CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Você tem acesso a {orgs.length} organizações. Escolha qual deseja acessar.
          </p>
        </div>

        <div className="space-y-3">
          {orgs.map(org => (
            <button
              key={org.organization_id}
              onClick={() => handleSelect(org.organization_id)}
              disabled={switching !== null}
              className="w-full bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl p-5 flex items-center gap-4 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-500/30 transition-all disabled:opacity-50 group"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0">
                {(org.organizations?.name || '?').substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-slate-900 dark:text-white text-lg">
                  {org.organizations?.name}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {org.role === UserRole.ADMIN ? 'Administrador' : 'Vendedor'}
                </p>
              </div>
              {switching === org.organization_id ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary-500 transition-colors" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
