import { saveAs } from 'file-saver'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
} from 'docx'
import TurndownService from 'turndown'

// Markdown
export function exportToMarkdown(editor, filename) {
  const html = editor.getHTML()
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  const md = td.turndown(html)
  saveAs(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)
}

// PDF (browser print)
export function exportToPdf(filename) {
  const old = document.title
  document.title = filename
  window.print()
  document.title = old
}

// DOCX
export async function exportToDocx(editor, filename) {
  const json = editor.getJSON()
  const children = await nodesToDocx(json.content || [])
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 24 } } } },
    sections: [{ children }],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${filename}.docx`)
}

async function nodesToDocx(nodes) {
  const out = []
  for (const node of nodes) {
    out.push(...(await nodeToDocx(node)))
  }
  return out
}

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
}

async function nodeToDocx(node) {
  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ children: inlineNodes(node.content || []) })]
    case 'heading':
      return [new Paragraph({ heading: HEADING_MAP[node.attrs?.level] || HeadingLevel.HEADING_1, children: inlineNodes(node.content || []) })]
    case 'bulletList':
    case 'orderedList': {
      const items = []
      for (const item of node.content || []) {
        for (const para of item.content || []) {
          items.push(new Paragraph({ bullet: { level: 0 }, children: inlineNodes(para.content || []) }))
        }
      }
      return items
    }
    case 'blockquote':
      return await nodesToDocx(node.content || [])
    case 'codeBlock':
      return [new Paragraph({ children: [new TextRun({ text: node.content?.map((n) => n.text).join('') || '', font: 'Courier New', size: 20 })] })]
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' } } })]
    case 'table': {
      const rows = (node.content || []).map((rowNode) =>
        new TableRow({
          children: (rowNode.content || []).map((cellNode) =>
            new TableCell({
              width: { size: 2000, type: WidthType.DXA },
              children: (cellNode.content || []).map((para) => new Paragraph({ children: inlineNodes(para.content || []) })),
            })
          ),
        })
      )
      return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })]
    }
    case 'image': {
      const src = node.attrs?.src
      if (src?.startsWith('data:image')) {
        try {
          const [header, base64] = src.split(',')
          const ext = (header.match(/data:(image\/\w+);/)?.[1] || 'image/png').split('/')[1]
          const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
          return [new Paragraph({ children: [new ImageRun({ data: buffer, transformation: { width: 400, height: 300 }, type: ext })] })]
        } catch { return [] }
      }
      return []
    }
    default:
      return []
  }
}

function inlineNodes(nodes) {
  return nodes.map((node) => {
    if (node.type !== 'text') return new TextRun('')
    const marks = node.marks || []
    const hasMark = (type) => marks.some((m) => m.type === type)
    const markAttr = (type, attr) => marks.find((m) => m.type === type)?.attrs?.[attr]
    const color = markAttr('color', 'color')?.replace('#', '')
    return new TextRun({
      text: node.text || '',
      bold: hasMark('bold'),
      italics: hasMark('italic'),
      underline: hasMark('underline') ? {} : undefined,
      strike: hasMark('strike'),
      color: color || undefined,
    })
  })
}
