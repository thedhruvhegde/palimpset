// Entry point. Screens are built from .kiro/specs/vellum-ui/tasks.md.
const app = document.getElementById('app');
if (app) {
  app.innerHTML = `
    <main class="shell">
      <h1 class="display">See what your files are still hiding.</h1>
      <p class="lede">Palimpsest finds hidden data in photos, screenshots, PDFs and Word documents, shows you where it is, and gives you a clean copy. Nothing leaves your browser.</p>
    </main>`;
}
