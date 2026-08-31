// The signed-in app, loaded as its own chunk so the landing page doesn't download the
// notation and audio libraries.
import './editor.css'
import { Editor } from './Editor'
import { NewScore } from './NewScore'
import { useEditor } from './store'

export default function Workspace() {
  const screen = useEditor((s) => s.screen)
  return screen === 'new' ? <NewScore /> : <Editor />
}
