import { useEffect } from 'react'
import { Editor } from './editor/Editor'
import { useEditor } from './editor/store'

let started = false

function App() {
  useEffect(() => {
    // StrictMode runs effects twice in development; load the workspace once.
    if (started) return
    started = true
    void useEditor.getState().init()
  }, [])
  return <Editor />
}

export default App
