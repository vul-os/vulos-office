import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Placeholder from '@tiptap/extension-placeholder'
import {
  ArrowLeft, Save, Loader2, Play, Plus, Trash2,
  ChevronUp, ChevronDown, Download, EyeOff,
} from 'lucide-react'
import { useFilesStore } from '../../store/filesStore'
import { api } from '../../lib/api'
import SlidePreview from './SlidePreview'
import { exportSlidesToPdf, exportSlidesToPptx } from './slidesExport'

const THEMES = ['black', 'white', 'league', 'beige', 'sky', 'night', 'serif', 'simple', 'solarized', 'moon', 'dracula']
const TRANSITIONS = ['none', 'fade', 'slide', 'convex', 'concave', 'zoom']

function newSlide() {
  return { id: crypto.randomUUID(), title: '', content: '<p></p>', notes: '', background: '' }
}

export default function SlidesEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { files, updateFile } = useFilesStore()
  const stored = files.find((f) => f.id === id)
  const [file, setFile] = useState(stored)

  const defaultData = file?.content && file.content.slides
    ? file.content
    : { theme: 'black', transition: 'slide', slides: [newSlide()] }

  const [title, setTitle] = useState(file?.name || 'Untitled Presentation')
  const [slidesData, setSlidesData] = useState(defaultData)
  const [activeIdx, setActiveIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [presenting, setPresenting] = useState(false)
  const saveTimer = useRef(null)
  const imgInput = useRef(null)

  const activeSlide = slidesData.slides[activeIdx] ?? slidesData.slides[0]

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: 'Slide content…' }),
    ],
    content: activeSlide?.content || '<p></p>',
    onUpdate: ({ editor }) => {
      updateSlideField(activeIdx, 'content', editor.getHTML())
    },
  })

  useEffect(() => {
    if (!file && id) {
      api.getFile(id).then((f) => {
        setFile(f)
        setTitle(f.name)
        if (f.content?.slides) setSlidesData(f.content)
      }).catch(() => navigate('/'))
    }
  }, [id])

  // Sync editor when switching slides
  useEffect(() => {
    if (editor && activeSlide) {
      editor.commands.setContent(activeSlide.content || '<p></p>', false)
    }
  }, [activeIdx]) // eslint-disable-line

  const autosave = useCallback(async (sd) => {
    if (!id) return
    setSaving(true)
    try {
      await updateFile(id, title, sd)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }, [id, title])

  const schedule = (sd) => {
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autosave(sd), 2000)
  }

  const updateSlideField = (idx, field, value) => {
    setSlidesData((prev) => {
      const slides = [...prev.slides]
      slides[idx] = { ...slides[idx], [field]: value }
      const next = { ...prev, slides }
      schedule(next)
      return next
    })
  }

  const addSlide = () => {
    setSlidesData((prev) => {
      const slides = [...prev.slides, newSlide()]
      const next = { ...prev, slides }
      schedule(next)
      setActiveIdx(slides.length - 1)
      return next
    })
  }

  const deleteSlide = (idx) => {
    setSlidesData((prev) => {
      if (prev.slides.length === 1) return prev
      const slides = prev.slides.filter((_, i) => i !== idx)
      const next = { ...prev, slides }
      schedule(next)
      setActiveIdx(Math.min(idx, slides.length - 1))
      return next
    })
  }

  const moveSlide = (idx, dir) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= slidesData.slides.length) return
    setSlidesData((prev) => {
      const slides = [...prev.slides];
      [slides[idx], slides[newIdx]] = [slides[newIdx], slides[idx]]
      const next = { ...prev, slides }
      schedule(next)
      setActiveIdx(newIdx)
      return next
    })
  }

  const updateMeta = (key, value) => {
    const next = { ...slidesData, [key]: value }
    setSlidesData(next)
    schedule(next)
  }

  const handleImageUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f || !editor) return
    try {
      const { url } = await api.uploadImage(f)
      editor.chain().focus().setImage({ src: url }).run()
    } catch {
      const reader = new FileReader()
      reader.onload = (ev) => { if (ev.target?.result) editor.chain().focus().setImage({ src: ev.target.result }).run() }
      reader.readAsDataURL(f)
    }
    e.target.value = ''
  }

  if (!editor) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={24} /></div>

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition"><ArrowLeft size={18} /></button>
        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-amber-600 fill-current"><path d="M21 3H3a2 2 0 00-2 2v14a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H3V5h18v14zM7 12H5v5h2v-5zm4-3H9v8h2V9zm4 2h-2v6h2v-6zm4-4h-2v10h2V7z"/></svg>
        </div>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setSaved(false) }}
          className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-2 py-0.5"
          placeholder="Untitled Presentation"
        />
        <span className="text-xs text-gray-400 hidden sm:block">{saving ? 'Saving…' : saved ? 'Saved' : 'Unsaved'}</span>
        <button
          onClick={() => setPresenting(!presenting)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition"
        >
          {presenting ? <><EyeOff size={14} /> Edit</> : <><Play size={14} /> Present</>}
        </button>
        <button
          onClick={() => { clearTimeout(saveTimer.current); autosave(slidesData) }}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-60 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
            <Download size={14} /> Export ▾
          </button>
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 text-sm hidden group-hover:block">
            <button onClick={() => exportSlidesToPdf(title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">PDF (print)</button>
            <button onClick={() => exportSlidesToPptx(slidesData, title)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">PowerPoint (.pptx)</button>
          </div>
        </div>
      </div>

      {presenting ? (
        <SlidePreview data={slidesData} onClose={() => setPresenting(false)} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Slide list */}
          <div className="w-52 flex-shrink-0 bg-gray-900 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Slides ({slidesData.slides.length})</span>
              <button onClick={addSlide} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition"><Plus size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {slidesData.slides.map((slide, idx) => (
                <div
                  key={slide.id}
                  onClick={() => setActiveIdx(idx)}
                  className={`group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${idx === activeIdx ? 'border-amber-500' : 'border-transparent hover:border-gray-600'}`}
                >
                  <div
                    className="h-24 bg-gray-800 flex flex-col items-center justify-center p-2 text-center"
                    style={{ background: slide.background || undefined }}
                  >
                    <div className="text-white text-xs font-bold truncate w-full">{slide.title || `Slide ${idx + 1}`}</div>
                    <div className="text-gray-400 text-[9px] mt-1 w-full overflow-hidden line-clamp-3" dangerouslySetInnerHTML={{ __html: slide.content }} />
                  </div>
                  <div className="absolute top-1 left-1 text-[9px] text-gray-500 bg-black/40 px-1 rounded">{idx + 1}</div>
                  <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); moveSlide(idx, -1) }} className="p-0.5 rounded bg-black/50 text-gray-300 hover:text-white"><ChevronUp size={10} /></button>
                    <button onClick={(e) => { e.stopPropagation(); moveSlide(idx, 1) }} className="p-0.5 rounded bg-black/50 text-gray-300 hover:text-white"><ChevronDown size={10} /></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteSlide(idx) }} className="p-0.5 rounded bg-black/50 text-red-400 hover:text-red-300"><Trash2 size={10} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-3 border-t border-gray-800 space-y-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Theme</label>
                <select value={slidesData.theme} onChange={(e) => updateMeta('theme', e.target.value)} className="w-full bg-gray-800 text-gray-200 text-xs rounded-lg px-2 py-1.5 border border-gray-700 focus:outline-none">
                  {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Transition</label>
                <select value={slidesData.transition} onChange={(e) => updateMeta('transition', e.target.value)} className="w-full bg-gray-800 text-gray-200 text-xs rounded-lg px-2 py-1.5 border border-gray-700 focus:outline-none">
                  {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Editor */}
          {activeSlide && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 pt-4 pb-2 bg-white border-b border-gray-100">
                <input
                  value={activeSlide.title}
                  onChange={(e) => updateSlideField(activeIdx, 'title', e.target.value)}
                  className="w-full text-2xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300"
                  placeholder="Slide title…"
                />
              </div>

              {/* Mini toolbar */}
              <div className="flex items-center gap-1 px-4 py-1.5 bg-white border-b border-gray-100 flex-wrap">
                {[
                  { label: 'B', fn: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold'), style: 'font-bold' },
                  { label: 'I', fn: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), style: 'italic' },
                  { label: 'U', fn: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive('underline'), style: 'underline' },
                ].map(({ label, fn, active, style }) => (
                  <button key={label} onClick={fn} className={`toolbar-btn w-7 h-7 text-sm ${style} ${active ? 'active' : ''}`}>{label}</button>
                ))}
                <span className="toolbar-divider" />
                <button onClick={() => editor.chain().focus().setTextAlign('left').run()} className="toolbar-btn text-xs px-1.5">≡L</button>
                <button onClick={() => editor.chain().focus().setTextAlign('center').run()} className="toolbar-btn text-xs px-1.5">≡C</button>
                <button onClick={() => editor.chain().focus().setTextAlign('right').run()} className="toolbar-btn text-xs px-1.5">≡R</button>
                <span className="toolbar-divider" />
                <button onClick={() => editor.chain().focus().toggleBulletList().run()} className="toolbar-btn text-xs px-2">• List</button>
                <button onClick={() => imgInput.current?.click()} className="toolbar-btn text-xs px-2">Image</button>
                <input ref={imgInput} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <span className="toolbar-divider" />
                <label className="toolbar-btn flex items-center gap-1 text-xs px-2 cursor-pointer">
                  BG
                  <input type="color" className="w-4 h-4 rounded cursor-pointer" value={activeSlide.background || '#1a1a2e'} onChange={(e) => updateSlideField(activeIdx, 'background', e.target.value)} />
                </label>
              </div>

              <div className="flex-1 overflow-auto p-6 bg-gray-50">
                <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8 min-h-64">
                  <EditorContent editor={editor} className="tiptap" />
                </div>
              </div>

              <div className="px-6 py-3 bg-yellow-50 border-t border-yellow-100 flex-shrink-0">
                <label className="text-xs font-semibold text-yellow-700 block mb-1">Speaker Notes</label>
                <textarea
                  value={activeSlide.notes}
                  onChange={(e) => updateSlideField(activeIdx, 'notes', e.target.value)}
                  className="w-full h-16 text-sm bg-transparent border-none outline-none resize-none text-yellow-800 placeholder-yellow-400"
                  placeholder="Add speaker notes…"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
