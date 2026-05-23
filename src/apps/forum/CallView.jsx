import { useEffect, useRef, useState, useCallback } from 'react'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, Wifi, WifiOff, MessageSquare, Monitor, MonitorOff } from 'lucide-react'
import { createCall } from '../../lib/call/rtc'
import InCallChat from './InCallChat.jsx'

// CallView — Forum 1:1 + group voice/video call surface.
// Props:
//   sessionId    — fabric session id for this call (channel id, DM id, room id)
//   channelId    — Forum channel/thread id for persisted in-call chat (OFFICE-66)
//   threadParent — optional thread-parent message id for meeting-room threads
//   identity     — { displayName, vumail, color } (best-effort; reused by presence)
//   video        — start with camera on (default true)
//   onLeave      — called after the call tears down

export default function CallView({ sessionId, channelId, threadParent = '', identity, video = true, onLeave }) {
  const [call, setCall] = useState(null)
  const [error, setError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(!video)
  const [peers, setPeers] = useState([])
  const [activeSpeaker, setActiveSpeaker] = useState(null)
  const [transport, setTransport] = useState('p2p')
  const [state, setState] = useState('connecting')
  const [showRoster, setShowRoster] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  // screenPresenter: 'local' | peerId | null
  const [screenPresenter, setScreenPresenter] = useState(null)
  const localVideoRef = useRef(null)
  const screenPreviewRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let activeCall = null
    ;(async () => {
      try {
        const c = await createCall({ sessionId, identity, video })
        if (cancelled) { c.leave(); return }
        activeCall = c
        setCall(c)
        setState(c.state)
        setMuted(c.muted)
        setCameraOff(c.cameraOff)
        setScreenSharing(c.screenSharing)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = c.localStream
        }
        c.on('peers-changed', (p) => setPeers([...p]))
        c.on('active-speaker', (id) => setActiveSpeaker(id))
        c.on('transport', (t) => setTransport(t))
        c.on('state', (s) => setState(s))
        c.on('screen-share', (peerId) => setScreenPresenter(peerId))
      } catch (e) {
        console.error(e)
        if (!cancelled) setError(e.message || String(e))
      }
    })()
    return () => {
      cancelled = true
      if (activeCall) activeCall.leave()
    }
  }, [sessionId])

  // Wire local stream to <video> when it appears (re-renders may swap node).
  useEffect(() => {
    if (call && localVideoRef.current && localVideoRef.current.srcObject !== call.localStream) {
      localVideoRef.current.srcObject = call.localStream
    }
  }, [call, peers.length])

  // Wire local screen stream to the preview element.
  useEffect(() => {
    if (screenPreviewRef.current) {
      screenPreviewRef.current.srcObject =
        screenSharing && call?.screenStream ? call.screenStream : null
    }
  }, [screenSharing, call])

  const handleMute = useCallback(() => {
    if (!call) return
    setMuted(call.toggleMute())
  }, [call])

  const handleCamera = useCallback(() => {
    if (!call) return
    setCameraOff(call.toggleCamera())
  }, [call])

  const handleLeave = useCallback(() => {
    if (call) call.leave()
    onLeave?.()
  }, [call, onLeave])

  const handleScreenShare = useCallback(async () => {
    if (!call) return
    if (screenSharing) {
      call.stopScreenShare()
      setScreenSharing(false)
      setScreenPresenter(null)
    } else {
      try {
        await call.startScreenShare()
        setScreenSharing(true)
        setScreenPresenter('local')
      } catch (e) {
        // User cancelled or permission denied — silently ignore.
        console.warn('[screen-share] aborted:', e.message)
      }
    }
  }, [call, screenSharing])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8">
        <div className="text-xl mb-2">Couldn't start the call</div>
        <div className="text-sm text-gray-400 mb-6">{error}</div>
        <button
          onClick={handleLeave}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg"
        >Close</button>
      </div>
    )
  }

  const totalTiles = peers.length + 1
  const cols = totalTiles <= 1 ? 1 : totalTiles <= 4 ? 2 : 3

  // Remote peer who is presenting (screen-share from the other side).
  const presentingPeer = screenPresenter && screenPresenter !== 'local'
    ? peers.find((p) => p.peerId === screenPresenter) ?? null
    : null

  const anyScreenActive = screenSharing || !!presentingPeer

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      <CallHeader
        state={state}
        transport={transport}
        participantCount={totalTiles}
        onToggleRoster={() => setShowRoster((v) => !v)}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Prominent screen-share area */}
          {anyScreenActive && (
            <ScreenShareView
              isLocal={screenSharing && screenPresenter === 'local'}
              localRef={screenPreviewRef}
              presenterPeer={presentingPeer}
              presenterLabel={
                screenPresenter === 'local'
                  ? (identity?.displayName || 'You')
                  : (presentingPeer?.identity?.displayName || (presentingPeer?.peerId?.slice(0, 6) ?? 'Peer'))
              }
            />
          )}

          {/* Participant tiles */}
          <div
            className="flex-1 grid gap-2 p-3 overflow-auto"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            <Tile
              label={identity?.displayName ? `${identity.displayName} (you)` : 'You'}
              muted={muted}
              cameraOff={cameraOff}
              isLocal
              videoRef={localVideoRef}
              color={identity?.color}
              isPresenting={screenPresenter === 'local'}
            />
            {peers.map((p) => (
              <RemoteTile
                key={p.peerId}
                peer={p}
                isSpeaking={activeSpeaker === p.peerId}
              />
            ))}
          </div>
        </div>

        {showRoster && (
          <Roster peers={peers} self={identity} activeSpeaker={activeSpeaker} screenPresenter={screenPresenter} />
        )}
        {showChat && channelId && (
          <InCallChat
            channelId={channelId}
            threadParent={threadParent}
            identity={identity}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>

      <Controls
        muted={muted}
        cameraOff={cameraOff}
        screenSharing={screenSharing}
        onMute={handleMute}
        onCamera={handleCamera}
        onScreenShare={handleScreenShare}
        onLeave={handleLeave}
        onToggleRoster={() => setShowRoster((v) => !v)}
        onToggleChat={channelId ? () => setShowChat((v) => !v) : null}
        chatActive={showChat}
      />
    </div>
  )
}

// ScreenShareView — prominent area for screen content (local preview or remote).
function ScreenShareView({ isLocal, localRef, presenterPeer, presenterLabel }) {
  const remoteRef = useRef(null)
  useEffect(() => {
    if (!isLocal && remoteRef.current && presenterPeer?.stream) {
      if (remoteRef.current.srcObject !== presenterPeer.stream) {
        remoteRef.current.srcObject = presenterPeer.stream
      }
    }
  }, [isLocal, presenterPeer?.stream])

  return (
    <div
      className="relative mx-3 mt-3 rounded-xl bg-black overflow-hidden flex-shrink-0"
      style={{ height: '55%', minHeight: 200 }}
    >
      {isLocal ? (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
      ) : (
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="w-full h-full object-contain"
        />
      )}
      <div className="absolute top-2 left-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-full text-xs text-white">
        <Monitor size={12} className="text-blue-400" />
        <span>{presenterLabel} is presenting</span>
        {isLocal && (
          <span className="ml-1 bg-blue-600 px-1.5 py-0.5 rounded text-[10px]">You</span>
        )}
      </div>
    </div>
  )
}

function CallHeader({ state, transport, participantCount, onToggleRoster }) {
  const stateLabel =
    state === 'connecting' ? 'Connecting…' :
    state === 'connected' ? 'Connected' :
    state === 'closed' ? 'Call ended' : state
  return (
    <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-3 text-sm">
      <span className="text-gray-300">{stateLabel}</span>
      <span className="flex items-center gap-1 text-gray-400">
        {transport === 'relay' ? <WifiOff size={14} /> : <Wifi size={14} />}
        <span>{transport === 'relay' ? 'Relay (TURN)' : 'P2P'}</span>
      </span>
      <button
        onClick={onToggleRoster}
        className="ml-auto flex items-center gap-1 text-gray-300 hover:text-white"
      >
        <Users size={14} />
        <span>{participantCount}</span>
      </button>
    </div>
  )
}

function Tile({ label, muted, cameraOff, isLocal, videoRef, color, isPresenting }) {
  return (
    <div
      className="relative rounded-lg bg-gray-800 overflow-hidden flex items-center justify-center min-h-[140px]"
      style={{ outline: isPresenting ? '2px solid #60a5fa' : color ? `2px solid ${color}` : undefined }}
    >
      {!cameraOff && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      )}
      {cameraOff && (
        <div className="text-gray-500 text-3xl uppercase font-semibold">
          {(label || '?').slice(0, 1)}
        </div>
      )}
      <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-xs text-white/90">
        <span className="bg-black/40 px-2 py-0.5 rounded flex items-center gap-1">
          {isPresenting && <Monitor size={10} className="text-blue-300" />}
          {label}
        </span>
        {muted && <MicOff size={14} className="bg-black/40 p-0.5 rounded" />}
      </div>
    </div>
  )
}

function RemoteTile({ peer, isSpeaking }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && peer.stream && ref.current.srcObject !== peer.stream) {
      ref.current.srcObject = peer.stream
    }
  }, [peer.stream])
  const label = peer.identity?.displayName || peer.peerId.slice(0, 6)
  const noVideo = !peer.stream || peer.stream.getVideoTracks().every((t) => !t.enabled)
  return (
    <div
      className="relative rounded-lg bg-gray-800 overflow-hidden flex items-center justify-center min-h-[140px] transition-all"
      style={{
        outline: peer.isPresenting
          ? '2px solid #60a5fa'
          : isSpeaking ? '3px solid #34d399' : undefined,
      }}
    >
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
      {noVideo && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-3xl uppercase font-semibold">
          {label.slice(0, 1)}
        </div>
      )}
      <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-xs">
        <span className="bg-black/40 px-2 py-0.5 rounded flex items-center gap-1">
          {peer.isPresenting && <Monitor size={10} className="text-blue-300" />}
          {label}
        </span>
        {peer.usingRelay && (
          <span className="bg-amber-700/70 px-2 py-0.5 rounded text-[10px]">relay</span>
        )}
      </div>
    </div>
  )
}

function Roster({ peers, self, activeSpeaker, screenPresenter }) {
  return (
    <aside className="w-60 border-l border-gray-800 bg-gray-900 overflow-y-auto p-3 text-sm">
      <h3 className="text-xs uppercase text-gray-500 mb-2">Participants ({peers.length + 1})</h3>
      <ul className="space-y-1">
        <li className="flex items-center justify-between py-1">
          <span className="flex items-center gap-1">
            {screenPresenter === 'local' && <Monitor size={12} className="text-blue-400" />}
            {self?.displayName || 'You'} <span className="text-gray-500">(you)</span>
          </span>
        </li>
        {peers.map((p) => (
          <li
            key={p.peerId}
            className="flex items-center justify-between py-1"
          >
            <span className={`flex items-center gap-1 ${activeSpeaker === p.peerId ? 'text-emerald-300' : ''}`}>
              {p.isPresenting && <Monitor size={12} className="text-blue-400" />}
              {p.identity?.displayName || p.peerId.slice(0, 6)}
            </span>
            <span className="text-[10px] text-gray-500">
              {p.usingRelay ? 'relay' : p.state}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function Controls({ muted, cameraOff, screenSharing, onMute, onCamera, onScreenShare, onLeave, onToggleRoster, onToggleChat, chatActive }) {
  return (
    <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-center gap-3">
      <CtrlBtn onClick={onMute} active={!muted} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <MicOff size={18} /> : <Mic size={18} />}
      </CtrlBtn>
      <CtrlBtn onClick={onCamera} active={!cameraOff} title={cameraOff ? 'Camera on' : 'Camera off'}>
        {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
      </CtrlBtn>
      <CtrlBtn
        onClick={onScreenShare}
        active={!screenSharing}
        title={screenSharing ? 'Stop sharing' : 'Share screen'}
        screenSharing={screenSharing}
      >
        {screenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
      </CtrlBtn>
      <CtrlBtn onClick={onToggleRoster} active title="Participants">
        <Users size={18} />
      </CtrlBtn>
      {onToggleChat && (
        <CtrlBtn onClick={onToggleChat} active={!chatActive} title="In-call chat">
          <MessageSquare size={18} />
        </CtrlBtn>
      )}
      <button
        onClick={onLeave}
        className="ml-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-full flex items-center gap-2"
        title="Leave call"
      >
        <PhoneOff size={18} />
        <span className="text-sm">Leave</span>
      </button>
    </div>
  )
}

function CtrlBtn({ children, onClick, active, title, screenSharing }) {
  // Screen-share button uses blue when actively sharing instead of red.
  const cls = screenSharing
    ? 'bg-blue-600 hover:bg-blue-500 text-white'
    : active
      ? 'bg-gray-700 hover:bg-gray-600 text-white'
      : 'bg-red-600 hover:bg-red-500 text-white'
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-11 h-11 rounded-full flex items-center justify-center transition ${cls}`}
    >
      {children}
    </button>
  )
}
