// Sign-in state. With no Supabase settings the app runs without accounts (local development).

import { createClient, type Session } from '@supabase/supabase-js'
import { create } from 'zustand'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

type AuthState = {
  /** False when Supabase isn't configured: everyone is the local user. */
  enabled: boolean
  /** Whether the stored session has been checked yet. */
  ready: boolean
  session: Session | null
  signInWithEmail: (email: string) => Promise<string | null>
  verifyCode: (email: string, code: string) => Promise<string | null>
  signOut: () => Promise<void>
}

export const useAuth = create<AuthState>()(() => ({
  enabled: supabase !== null,
  ready: supabase === null,
  session: null,

  /**
   * Emails a one-time code. A code rather than a link: mail scanners (Outlook Safe Links)
   * open links before the person does, which uses them up. Returns an error message, or null.
   */
  signInWithEmail: async (email) => {
    if (!supabase) return null
    const { error } = await supabase.auth.signInWithOtp({ email })
    return error ? error.message : null
  },

  /** Signs in with the emailed code; the session arrives through onAuthStateChange. */
  verifyCode: async (email, code) => {
    if (!supabase) return null
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    return error ? error.message : null
  },

  signOut: async () => {
    await supabase?.auth.signOut()
    // Start clean: no other user's scores or state left in memory.
    window.location.assign('/')
  },
}))

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    useAuth.setState({ session: data.session, ready: true })
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({ session, ready: true })
  })
}

/** The current access token for API calls, or null without auth. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** The API said the session isn't valid (expired, revoked): back to sign-in. */
export function sessionRejected() {
  if (supabase) useAuth.setState({ session: null })
}
