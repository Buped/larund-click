import ReactDOM from 'react-dom/client';
import { OverlayApp } from './components/overlay';
import './index.css';

// The overlay floats over arbitrary desktop content, so it always renders in
// dark for legibility — it deliberately does not follow the app theme.
document.documentElement.setAttribute('data-theme', 'dark');

ReactDOM.createRoot(
  document.getElementById('root')!
).render(<OverlayApp />);
