import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ToastProvider, DialogProvider, ContextMenuProvider } from './components/ui'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } },
})

// Theme is remembered locally; all real data lives in the database.
const savedTheme = localStorage.getItem('shq-theme') || 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DialogProvider>
          <ContextMenuProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ContextMenuProvider>
        </DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
