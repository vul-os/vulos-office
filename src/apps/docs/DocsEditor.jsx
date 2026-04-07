import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { useFilesStore } from '../../store/filesStore'
import { api } from '../../lib/api'
import DocsToolbar from './DocsToolbar'

// Imported files may carry _html; use that as editor content
function resolveContent(content) {
  if (!content) return { type: 'doc', content: [{ type: 'paragraph' }] }
  if (content._html) return content._html  // TipTap accepts HTML string
  return content
}

export default function DocsEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { files, updateFile } = useFilesStore()
  const [file, setFile] = useState(files.find((f) => f.id === id))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [title, setTitle] = useState(file?.name || 'Untitled')
  const [pendingContent, setPendingContent] = useState(null)
  const saveTimer = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Image.configure({ allowBase64: true }),
      Link.configure({ openOnClick: false }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Typography,
    ],
    content: resolveContent(file?.content),
    onUpdate: () => {
      setSaved(false)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => autosave(), 2000)
    },
  })

  useEffect(() => {
    if (!file && id) {
      api.getFile(id).then((f) => {
        setFile(f)
        setTitle(f.name)
        setPendingContent(resolveContent(f.content))
      }).catch(() => navigate('/docs'))
    }
  }, [id])

  // Apply pending content once editor is ready
  useEffect(() => {
    if (editor && pendingContent !== null) {
      editor.commands.setContent(pendingContent, false)
      setPendingContent(null)
    }
  }, [editor, pendingContent])

  const autosave = useCallback(async () => {
    if (!editor || !id) return
    setSaving(true)
    try {
      await updateFile(id, title, editor.getJSON())
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }, [editor, id, title])

  const handleSave = () => {
    clearTimeout(saveTimer.current)
    autosave()
  }

  const handleTitleChange = (newTitle) => {
    setTitle(newTitle)
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autosave(), 1500)
  }

  const wordCount = editor?.storage.characterCount?.words() ?? 0
  const charCount = editor?.storage.characterCount?.characters() ?? 0

  if (!editor) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={24} /></div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
        <button onClick={() => navigate('/docs')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-indigo-600 fill-current"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8zm0-4h5v2H8z"/></svg>
        </div>
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-2 py-0.5"
          placeholder="Untitled Document"
        />
        <span className="text-xs text-gray-400 hidden sm:block">{saving ? 'Saving…' : saved ? 'Saved' : 'Unsaved'}</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>

      <DocsToolbar editor={editor} title={title} />

      {/* Page canvas */}
      <div className="flex-1 overflow-auto bg-gray-100">
        <div className="max-w-[816px] min-h-full mx-auto bg-white shadow-sm my-6 px-16 py-16 rounded-lg">
          <EditorContent editor={editor} className="tiptap" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 px-4 py-1 bg-white border-t border-gray-100 text-xs text-gray-400">
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
      </div>
    </div>
  )
}
