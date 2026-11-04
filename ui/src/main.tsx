import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import ChatPage from './pages/ChatPage/ChatPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* <App /> */}
    <ChatPage />
  </StrictMode>,
);
