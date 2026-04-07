import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginScreen from './components/LoginScreen'
import Layout from './components/Layout'
import Home from './components/Home'
import AppHome from './components/AppHome'
import DocsEditor from './apps/docs/DocsEditor'
import SheetsEditor from './apps/sheets/SheetsEditor'
import SlidesEditor from './apps/slides/SlidesEditor'
import PDFEditor from './apps/pdf/PDFEditor'

export default function App() {
  const { status, loading, fetchStatus } = useAuthStore()

  useEffect(() => { fetchStatus() }, [])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status?.enabled && !status?.authenticated) {
    return <LoginScreen />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<AppHome type="doc" />} />
        <Route path="/sheets" element={<AppHome type="sheet" />} />
        <Route path="/slides" element={<AppHome type="slide" />} />
        <Route path="/docs/:id" element={<DocsEditor />} />
        <Route path="/sheets/:id" element={<SheetsEditor />} />
        <Route path="/slides/:id" element={<SlidesEditor />} />
        <Route path="/pdf-editor" element={<PDFEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
