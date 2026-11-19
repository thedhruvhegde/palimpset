// Entry point. Screens are built from .kiro/specs/vellum-ui/tasks.md.
const app = document.getElementById('app');
if (app) {
  app.innerHTML = `
    <main class="shell">
      <h1 class="display">Palimpsest</h1>
      <p class="lede">Your files are haunted by what you thought you deleted.</p>
    </main>`;
}
