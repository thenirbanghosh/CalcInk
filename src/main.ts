import '@fontsource-variable/inter';
import '@fontsource/caveat/latin-500.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/app';

const app = new App();

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true, onOfflineReady: () => app.setOfflineReady(true) });
  void navigator.serviceWorker.ready.then(() => app.setOfflineReady(true));
}

declare global {
  interface Window {
    calcink: App;
  }
}
window.calcink = app;
