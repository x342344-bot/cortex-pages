// Nav toggle
const toggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
if (toggle && navLinks) {
  toggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => navLinks.classList.remove('open'))
  );
}

// Card spotlight effect
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', (e.clientX - r.left) + 'px');
    card.style.setProperty('--mouse-y', (e.clientY - r.top) + 'px');
  });
});

// Scroll progress bar
window.addEventListener('scroll', () => {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  const h = document.documentElement;
  const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
  bar.style.width = Math.min(pct, 100) + '%';
}, { passive: true });
