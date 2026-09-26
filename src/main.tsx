import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './app/App'
import { LicenseProvider } from './features/license/LicenseDialog'
import { TutorialProvider } from './features/tutorial/TutorialProvider'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LicenseProvider>
      <TutorialProvider>
        <App />
      </TutorialProvider>
    </LicenseProvider>
  </React.StrictMode>,
)
