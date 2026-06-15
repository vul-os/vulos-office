import * as XLSX from 'xlsx'
import { marked } from 'marked'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { api } from './api'
import { useFilesStore } from '../store/filesStore'

// Map file extension → app type
export function detectType(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  if (['md', 'txt', 'doc', 'docx', 'rtf', 'html', 'htm'].includes(ext)) return 'doc'
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return 'sheet'
  if (['pptx', 'ppt'].includes(ext)) return 'slide'
  if (ext === 'pdf') return 'pdf'
  return null
}

export function typeToRoute(type) {
  if (type === 'doc') return 'docs'
  if (type === 'sheet') return 'sheets'
  if (type === 'slide') return 'slides'
  return null
}

// ── Converters ──────────────────────────────────────────────────────────────

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function convertToDocContent(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'md') {
    const text = await fileToText(file)
    const html = await marked.parse(text)
    // Wrap in TipTap doc structure via HTML
    return { type: 'doc', _html: html, content: [{ type: 'paragraph' }] }
  }

  if (ext === 'txt') {
    const text = await fileToText(file)
    const paragraphs = text.split(/\n\n+/).map(para => ({
      type: 'paragraph',
      content: para.trim()
        ? [{ type: 'text', text: para.replace(/\n/g, ' ').trim() }]
        : [],
    }))
    return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
  }

  if (ext === 'html' || ext === 'htm') {
    const text = await fileToText(file)
    return { type: 'doc', _html: text, content: [{ type: 'paragraph' }] }
  }

  if (ext === 'docx') {
    const buf = await fileToArrayBuffer(file)
    const result = await mammoth.convertToHtml({ arrayBuffer: buf })
    return { type: 'doc', _html: result.value || '<p></p>', content: [{ type: 'paragraph' }] }
  }

  // rtf / doc / other — render as plain text fallback
  try {
    const text = await fileToText(file)
    const paragraphs = text.split(/\n\n+/).filter(Boolean).map(p => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p.replace(/\n/g, ' ').trim() }],
    }))
    return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
}

async function convertToSheetContent(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const buf = await fileToArrayBuffer(file)

  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder().decode(buf)
    const sep = ext === 'tsv' ? '\t' : ','
    return csvToFortune(text, sep)
  }

  // xlsx / xls
  const wb = XLSX.read(buf, { type: 'array' })
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]
    if (!ws['!ref']) return { name, celldata: [], config: {} }
    const range = XLSX.utils.decode_range(ws['!ref'])
    const celldata = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (!cell) continue
        const v = cell.v ?? ''
        const m = cell.w || String(v)
        const f = cell.f ? `=${cell.f}` : undefined
        celldata.push({ r, c, v: { v, m, ...(f ? { f } : {}) } })
      }
    }
    // Preserve merged cells (!merges array → Fortune Sheet mc config)
    const merges = ws['!merges'] || []
    const mc = {}
    for (const merge of merges) {
      // merge: { s: {r,c}, e: {r,c} }
      const key = `${merge.s.r}_${merge.s.c}`
      mc[key] = {
        r: merge.s.r,
        c: merge.s.c,
        rs: merge.e.r - merge.s.r + 1,
        cs: merge.e.c - merge.s.c + 1,
      }
    }
    const config = merges.length ? { merge: mc } : {}
    return { name, celldata, config }
  })
}

function csvToFortune(text, sep = ',') {
  // Handle quoted fields
  const rows = text.trim().split(/\r?\n/)
  const celldata = []
  rows.forEach((row, r) => {
    const cells = parseCSVRow(row, sep)
    cells.forEach((val, c) => {
      const v = val.trim()
      if (!v) return
      const num = Number(v)
      const value = !isNaN(v) && v !== '' ? num : v
      celldata.push({ r, c, v: { v: value, m: v } })
    })
  })
  return [{ name: 'Sheet1', celldata, config: {} }]
}

function parseCSVRow(row, sep) {
  const cells = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === sep && !inQuote) {
      cells.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

// ── PPTX converter ───────────────────────────────────────────────────────────

/**
 * Extract all text runs (<a:t>) from a slide XML string grouped by shape (<p:sp>).
 * Returns an array of text-block arrays: [[run, run, ...], [run, run, ...], ...]
 * Each inner array corresponds to one shape's paragraph runs.
 */
function extractTextBlocksFromSlideXml(xmlText) {
  // Collect all <p:sp> shapes that have text bodies (<p:txBody>)
  const shapes = []
  // Match each <p:sp>...</p:sp> block
  const spRegex = /<p:sp[\s>][\s\S]*?<\/p:sp>/g
  let spMatch
  while ((spMatch = spRegex.exec(xmlText)) !== null) {
    const spXml = spMatch[0]
    // Only process shapes that have a text body
    if (!spXml.includes('<p:txBody>') && !spXml.includes('<p:txBody ')) continue
    // Collect all paragraphs <a:p> from this shape
    const paragraphs = []
    const pRegex = /<a:p[\s>][\s\S]*?<\/a:p>/g
    let pMatch
    while ((pMatch = pRegex.exec(spXml)) !== null) {
      const pXml = pMatch[0]
      // Collect all text runs <a:t> from this paragraph
      const runs = []
      const tRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
      let tMatch
      while ((tMatch = tRegex.exec(pXml)) !== null) {
        // Decode basic XML entities
        const text = tMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
        runs.push(text)
      }
      const combined = runs.join('').trim()
      if (combined) paragraphs.push(combined)
    }
    if (paragraphs.length) shapes.push(paragraphs)
  }
  return shapes
}

/**
 * Build a slide object (matching SlidesEditor's model) from a slide XML string.
 * Shape 0 → title, all remaining shapes → content (HTML list if multiple lines).
 */
function buildSlideFromXml(xmlText) {
  const shapes = extractTextBlocksFromSlideXml(xmlText)
  let title = ''
  const bodyLines = []

  shapes.forEach((paragraphs, shapeIdx) => {
    if (shapeIdx === 0) {
      // First shape = title (join multi-paragraph runs)
      title = paragraphs.join(' ')
    } else {
      paragraphs.forEach((p) => bodyLines.push(p))
    }
  })

  // Build TipTap-compatible HTML content
  let content = '<p></p>'
  if (bodyLines.length === 1) {
    content = `<p>${bodyLines[0]}</p>`
  } else if (bodyLines.length > 1) {
    const items = bodyLines.map((line) => `<li><p>${line}</p></li>`).join('')
    content = `<ul>${items}</ul>`
  }

  return {
    id: crypto.randomUUID(),
    title,
    content,
    notes: '',
    background: '',
    master: 'content',
    transition: 'none',
    animations: [],
  }
}

/**
 * Convert a .pptx File object to the slides content model:
 * { themeId, theme, transition, slides: [{ id, title, content, notes, ... }], masters, customTheme }
 */
async function convertToPptxContent(file) {
  const buf = await fileToArrayBuffer(file)
  const zip = await JSZip.loadAsync(buf)

  // Find all slide XML files in order: ppt/slides/slide1.xml, slide2.xml, ...
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)[1], 10)
      const numB = parseInt(b.match(/slide(\d+)\.xml/)[1], 10)
      return numA - numB
    })

  if (slideEntries.length === 0) {
    // No slides found — return a single blank slide
    return {
      themeId: 'obsidian',
      theme: 'black',
      transition: 'slide',
      slides: [{
        id: crypto.randomUUID(),
        title: '',
        content: '<p></p>',
        notes: '',
        background: '',
        master: 'content',
        transition: 'none',
        animations: [],
      }],
      masters: null,
      customTheme: null,
    }
  }

  const slides = await Promise.all(
    slideEntries.map(async (entryName) => {
      const xmlText = await zip.files[entryName].async('string')
      return buildSlideFromXml(xmlText)
    })
  )

  return {
    themeId: 'obsidian',
    theme: 'black',
    transition: 'slide',
    slides,
    masters: null,
    customTheme: null,
  }
}

// ── Import from File object (drag & drop / file picker) ──────────────────────

export async function importFile(file, navigate) {
  const type = detectType(file.name)
  const baseName = file.name.replace(/\.[^.]+$/, '')

  if (type === 'pdf') {
    const buf = await fileToArrayBuffer(file)
    sessionStorage.setItem('pendingPDF', JSON.stringify({
      name: file.name,
      data: btoa(String.fromCharCode(...new Uint8Array(buf).slice(0, 10 * 1024 * 1024))),
    }))
    navigate('/pdf-editor')
    return
  }

  if (!type) {
    throw new Error(`Cannot import .${file.name.split('.').pop()} files.`)
  }

  let content
  if (type === 'doc') {
    content = await convertToDocContent(file)
  } else if (type === 'sheet') {
    content = await convertToSheetContent(file)
  } else if (type === 'slide') {
    content = await convertToPptxContent(file)
  }

  const created = await api.createFile(baseName, type, content)
  useFilesStore.setState({ files: [created, ...useFilesStore.getState().files.filter(f => f.id !== created.id)] })
  navigate(`/${typeToRoute(type)}/${created.id}`)
}

// ── Import from a backend-served URL (local file scan) ────────────────────────

export async function importFromUrl(localFile, navigate) {
  const { name, path, appType } = localFile
  const baseName = name.replace(/\.[^.]+$/, '')
  const ext = name.split('.').pop().toLowerCase()
  const url = api.localFileUrl(path)

  if (appType === 'pdf') {
    // Pass URL directly to PDF editor via sessionStorage
    sessionStorage.setItem('pendingPDF', JSON.stringify({ name, url }))
    navigate('/pdf-editor')
    return
  }

  // Fetch the file from the backend
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch file')

  let content
  if (appType === 'slide') {
    const buf = await res.arrayBuffer()
    // Wrap the ArrayBuffer in a minimal File-like object for convertToPptxContent
    const blob = new Blob([buf])
    const pseudoFile = new File([blob], name)
    content = await convertToPptxContent(pseudoFile)
  } else if (appType === 'doc') {
    if (ext === 'md') {
      const text = await res.text()
      const html = await marked.parse(text)
      content = { type: 'doc', _html: html, content: [{ type: 'paragraph' }] }
    } else if (ext === 'txt') {
      const text = await res.text()
      const paragraphs = text.split(/\n\n+/).filter(Boolean).map(p => ({
        type: 'paragraph',
        content: [{ type: 'text', text: p.replace(/\n/g, ' ').trim() }],
      }))
      content = { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
    } else if (ext === 'html' || ext === 'htm') {
      const text = await res.text()
      content = { type: 'doc', _html: text, content: [{ type: 'paragraph' }] }
    } else if (ext === 'docx') {
      const buf = await res.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer: buf })
      content = { type: 'doc', _html: result.value || '<p></p>', content: [{ type: 'paragraph' }] }
    } else {
      // rtf / doc / other — plain text fallback
      const text = await res.text()
      const paragraphs = text.split(/\n\n+/).filter(Boolean).map(p => ({
        type: 'paragraph',
        content: [{ type: 'text', text: p.replace(/\n/g, ' ').trim() }],
      }))
      content = { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
    }
  } else {
    // sheet
    const buf = await res.arrayBuffer()
    if (ext === 'csv' || ext === 'tsv') {
      const text = new TextDecoder().decode(buf)
      content = csvToFortune(text, ext === 'tsv' ? '\t' : ',')
    } else {
      const wb = XLSX.read(buf, { type: 'array' })
      content = wb.SheetNames.map(sname => {
        const ws = wb.Sheets[sname]
        if (!ws['!ref']) return { name: sname, celldata: [], config: {} }
        const range = XLSX.utils.decode_range(ws['!ref'])
        const celldata = []
        for (let r = range.s.r; r <= range.e.r; r++) {
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })]
            if (!cell) continue
            const v = cell.v ?? ''
            celldata.push({ r, c, v: { v, m: cell.w || String(v), ...(cell.f ? { f: `=${cell.f}` } : {}) } })
          }
        }
        // Preserve merged cells (!merges → Fortune Sheet mc config)
        const merges = ws['!merges'] || []
        const mc = {}
        for (const merge of merges) {
          const key = `${merge.s.r}_${merge.s.c}`
          mc[key] = { r: merge.s.r, c: merge.s.c, rs: merge.e.r - merge.s.r + 1, cs: merge.e.c - merge.s.c + 1 }
        }
        const config = merges.length ? { merge: mc } : {}
        return { name: sname, celldata, config }
      })
    }
  }

  const created = await api.createFile(baseName, appType, content)
  useFilesStore.setState({ files: [created, ...useFilesStore.getState().files.filter(f => f.id !== created.id)] })
  navigate(`/${typeToRoute(appType)}/${created.id}`)
}
