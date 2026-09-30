import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { platform } from './platform/mac/adapter';
import './ui/style.css';
createRoot(document.getElementById('root')!).render(<App platform={platform} />);
