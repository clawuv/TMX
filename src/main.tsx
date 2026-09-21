import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import './index.css'

import './demos/ipc'
// If you want use Node.js, the`nodeIntegration` needs to be enabled in the Main process.
// import './demos/node'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Dismiss the launch splash only after the app's first painted frame, so the
// brand mark never flashes away to a blank background.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    postMessage({ payload: 'removeLoading' }, '*')
  })
})
