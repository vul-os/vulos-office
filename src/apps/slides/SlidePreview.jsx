import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function SlidePreview({ data, onClose }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    let deck = null

    import('reveal.js').then(({ default: Reveal }) => {
      deck = new Reveal(containerRef.current, {
        embedded: true,
        transition: data.transition || 'slide',
        margin: 0.04,
        controls: true,
        progress: true,
        slideNumber: true,
        hash: false,
        keyboard: true,
        overview: true,
        center: true,
      })
      deck.initialize()
    })

    return () => { try { deck?.destroy() } catch { /* ignore */ } }
  }, [data])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-4 right-4 z-10">
        <button onClick={onClose} className="p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition">
          <X size={18} />
        </button>
      </div>

      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0/reveal.min.css" />
      <link rel="stylesheet" href={`https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0/theme/${data.theme || 'black'}.min.css`} />

      <div ref={containerRef} className="reveal flex-1 w-full">
        <div className="slides">
          {data.slides.map((slide) => (
            <section key={slide.id} data-background={slide.background || undefined}>
              {slide.title && <h2>{slide.title}</h2>}
              <div dangerouslySetInnerHTML={{ __html: slide.content }} />
              {slide.notes && <aside className="notes">{slide.notes}</aside>}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
