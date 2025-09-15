// background.js (required by manifest MV3 background.service_worker)
self.addEventListener('install', () => {
  console.log('[background] installed');
});
self.addEventListener('activate', () => {
  console.log('[background] activated');
});
