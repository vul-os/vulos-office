// fabricSignaling.js — thin adapter over the OFFICE-20 fabric client.
//
// OFFICE-20 is being built in parallel and exposes (per TASKS.md):
//   fabric.join(sessionId, { identity }) → returns a session handle with
//   a duplex message channel: { send(msg), on('message', cb), on('peer-join',cb),
//   on('peer-leave',cb), on('state', cb), close() } where state ∈
//   'connecting' | 'p2p' | 'relay' | 'closed'.
//
// We treat signaling payloads as JSON envelopes:
//   { kind: 'sdp'|'ice'|'call-meta', to?: peerId, from: peerId, data: {...} }
//
// FIX-VITE-FABRIC-IMPORT-01: fabric.js is statically imported by
// src/lib/crdt/index.js, so the prior dynamic import here was defeated by
// Vite (mixed static+dynamic → warning, no code-splitting benefit). We pull
// it in statically as a namespace import; if the module doesn't expose
// joinSession (e.g. older builds) we fall through to the BroadcastChannel
// stub below, preserving the original adapter contract.
import * as _fabricMod from '../fabric.js'

function loadFabric() {
  return _fabricMod
}

class Emitter {
  constructor() { this._h = {} }
  on(ev, cb) { (this._h[ev] = this._h[ev] || []).push(cb); return () => this.off(ev, cb) }
  off(ev, cb) { this._h[ev] = (this._h[ev] || []).filter(f => f !== cb) }
  emit(ev, ...a) { (this._h[ev] || []).forEach(f => { try { f(...a) } catch (e) { console.error(e) } }) }
}

// BroadcastChannel fallback signaling (in-browser same-origin multi-tab).
function bcSession(sessionId, identity) {
  const em = new Emitter()
  const peerId = identity?.peerId || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
  const ch = new BroadcastChannel(`vulos-call:${sessionId}`)
  const peers = new Set()
  let state = 'connecting'

  const setState = (s) => { state = s; em.emit('state', s) }

  ch.onmessage = (ev) => {
    const m = ev.data
    if (!m || m.from === peerId) return
    if (m.kind === 'hello') {
      if (!peers.has(m.from)) { peers.add(m.from); em.emit('peer-join', m.from, m.identity) }
      // reply so the new peer learns about us
      ch.postMessage({ kind: 'hello-ack', from: peerId, identity, to: m.from })
      return
    }
    if (m.kind === 'hello-ack' && m.to === peerId) {
      if (!peers.has(m.from)) { peers.add(m.from); em.emit('peer-join', m.from, m.identity) }
      return
    }
    if (m.kind === 'bye') {
      if (peers.delete(m.from)) em.emit('peer-leave', m.from)
      return
    }
    if (m.to && m.to !== peerId) return
    em.emit('message', m)
  }

  // Announce
  setTimeout(() => {
    ch.postMessage({ kind: 'hello', from: peerId, identity })
    setState('p2p') // stub: assume direct
  }, 0)

  return {
    peerId,
    identity,
    transport: 'bc-stub',
    get state() { return state },
    send(msg) { ch.postMessage({ ...msg, from: peerId }) },
    on: em.on.bind(em),
    off: em.off.bind(em),
    close() {
      try { ch.postMessage({ kind: 'bye', from: peerId }) } catch {}
      try { ch.close() } catch {}
      setState('closed')
    },
  }
}

export async function joinSignalingSession(sessionId, identity) {
  const mod = await loadFabric()
  if (mod && typeof mod.joinSession === 'function') {
    // OFFICE-20 path. Expect joinSession(sessionId, {identity}) → handle
    const handle = await mod.joinSession(sessionId, { identity })
    // Normalize: ensure it exposes our expected event names.
    return handle
  }
  return bcSession(sessionId, identity)
}

// Fetch TURN/STUN credentials from the cloud (OFFICE-20 path) with a sane
// public-STUN default. Server endpoint mirrors what the OS fabric uses.
export async function fetchIceServers() {
  try {
    const r = await fetch('/api/turn/credentials', { credentials: 'include' })
    if (r.ok) {
      const body = await r.json()
      if (Array.isArray(body.iceServers) && body.iceServers.length) return body.iceServers
    }
  } catch { /* ignore — fall through */ }
  return [
    { urls: ['stun:stun.l.google.com:19302'] },
  ]
}
