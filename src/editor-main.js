import './style.css';
import { mountEditor } from '../renderer/editor/editor.js';

document.addEventListener('DOMContentLoaded', () => {
  console.log('📜 Markdown Editor Window Initialized');
  
  // Fade in the page
  document.body.style.opacity = '0';
  setTimeout(() => {
    document.body.style.transition = 'opacity 0.8s ease';
    document.body.style.opacity = '1';
  }, 100);

  // Mount the editor into the root element
  const editorRoot = document.getElementById('view-editor');
  if (editorRoot) {
    mountEditor(editorRoot);
  } else {
    console.error('Editor root not found.');
  }
});
