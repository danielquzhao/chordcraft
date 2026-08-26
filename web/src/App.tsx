import { useEffect } from 'react'
import { Editor } from './editor/Editor'
import { NewScore } from './editor/NewScore'
import { useEditor } from './editor/store'

let started = false

function App() {
  const screen = useEditor((s) => s.screen)
  useEffect(() => {
    // StrictMode runs effects twice in development; load the workspace once.
    if (started) return
    started = true
    void useEditor.getState().init()
  }, [])
  return screen === 'new' ? <NewScore /> : <Editor />
}

export default App
