import { lazy, Suspense, useEffect } from 'react'
import { useAuth } from './auth/store'
import { useEditor } from './editor/store'
import { Landing } from './landing/Landing'

const Workspace = lazy(() => import('./editor/Workspace'))

let loadedFor: string | null | undefined

function App() {
  const authEnabled = useAuth((s) => s.enabled)
  const ready = useAuth((s) => s.ready)
  const userId = useAuth((s) => s.session?.user.id ?? null)
  const signedIn = !authEnabled || userId !== null

  useEffect(() => {
    // Load the workspace once per signed-in user. StrictMode runs effects twice in
    // development, so remember who it was loaded for.
    if (!ready || !signedIn || loadedFor === userId) return
    loadedFor = userId
    void useEditor.getState().init()
  }, [ready, signedIn, userId])

  if (!ready) return null
  if (!signedIn) return <Landing />
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  )
}

export default App
