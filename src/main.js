import './style.css'
import './library.js'
import './fetcher.js'
import './analysis.js'
// SPA ROUTER — VIEW SWITCHER
// =============================

/**
 * Minimal in-app router.
 * Views are <div id="view-*"> elements toggled with .app-view--active.
 * A history stack tracks navigation so back/forward work correctly.
 */

const Router = {
  // Stack of { view, scrollY } entries. Think of it like browser history.
  _stack: [],
  // Pointer into _stack for current position (enables forward/back)
  _cursor: -1,

  _views: {},       // map of viewId -> element
  _backBtn: null,
  _fwdBtn: null,

  init() {
    // Collect all view elements
    document.querySelectorAll('.app-view').forEach(el => {
      // ids look like "view-home", "view-library" → key = "home", "library"
      const key = el.id.replace(/^view-/, '');
      this._views[key] = el;
    });

    this._backBtn = document.getElementById('navBack');
    this._fwdBtn = document.getElementById('navForward');

    // Initial state: home
    this._push('home');

    // Wire up back / forward buttons
    if (this._backBtn) {
      this._backBtn.addEventListener('click', () => this.back());
    }
    if (this._fwdBtn) {
      this._fwdBtn.addEventListener('click', () => this.forward());
    }

    // Keyboard shortcuts: Alt+Left = back, Alt+Right = forward
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); this.back(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); this.forward(); }
    });

    // Wire all [data-nav-view] triggers (buttons/links that switch views)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-nav-view]');
      if (!trigger) return;
      e.preventDefault();
      const viewName = trigger.getAttribute('data-nav-view');

      if (viewName === 'editor') {
        if (window.electronAPI?.window?.openEditor) {
          window.electronAPI.window.openEditor();
        } else {
          alert('Editor requires the Electron desktop application.');
        }
        return;
      }

      this.navigate(viewName);
    });

    // Logo / home button
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => this.navigate('home'));
    }

    // Scroll-to anchors that work both on the home view and within panels
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-scroll-to]');
      if (!trigger) return;
      e.preventDefault();
      const sectionId = trigger.getAttribute('data-scroll-to');
      // If we're not on home, go home first, then scroll
      if (this.current() !== 'home') {
        this.navigate('home');
        // Small delay to let the view switch render
        setTimeout(() => this._scrollToSection(sectionId), 50);
      } else {
        this._scrollToSection(sectionId);
      }
    });
  },

  // ---- public API ----

  navigate(viewName) {
    if (!this._views[viewName]) return;
    if (this.current() === viewName) return; // already here

    // Save scroll position of current view (for home)
    if (this._cursor >= 0) {
      this._stack[this._cursor].scrollY = window.scrollY;
    }

    // Truncate forward history when navigating fresh
    this._stack = this._stack.slice(0, this._cursor + 1);
    this._push(viewName);
    this._apply();
  },

  back() {
    if (this._cursor <= 0) return;
    this._stack[this._cursor].scrollY = window.scrollY;
    this._cursor--;
    this._apply();
  },

  forward() {
    if (this._cursor >= this._stack.length - 1) return;
    this._cursor++;
    this._apply();
  },

  current() {
    if (this._cursor < 0) return null;
    return this._stack[this._cursor].view;
  },

  // ---- private helpers ----

  _push(viewName) {
    this._stack.push({ view: viewName, scrollY: 0 });
    this._cursor = this._stack.length - 1;
  },

  _apply() {
    const entry = this._stack[this._cursor];
    if (!entry) return;

    // Hide all views
    Object.values(this._views).forEach(el => {
      el.classList.remove('app-view--active', 'app-view--entering');
      el.setAttribute('aria-hidden', 'true');
    });

    // Show target view with entering animation
    const target = this._views[entry.view];
    if (target) {
      target.classList.add('app-view--active', 'app-view--entering');
      target.removeAttribute('aria-hidden');
      // Restore scroll position
      window.scrollTo({ top: entry.scrollY, behavior: 'instant' });
    }

    // Update back/forward button states
    this._updateButtons();

    // Notify other modules
    document.dispatchEvent(new CustomEvent('app:viewChanged', {
      detail: { view: entry.view }
    }));
  },

  _updateButtons() {
    if (this._backBtn) this._backBtn.disabled = (this._cursor <= 0);
    if (this._fwdBtn) this._fwdBtn.disabled = (this._cursor >= this._stack.length - 1);
  },

  _scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const headerOffset = 100;
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top, behavior: 'smooth' });
  },
};

// ============================= 
// SCROLL ANIMATIONS (AOS-style)
// ============================= 

class ScrollAnimations {
  constructor() {
    this.elements = document.querySelectorAll('[data-aos]');
    this.init();
  }

  init() {
    // Check if elements are in viewport on load
    this.checkElements();

    // Check on scroll (throttled)
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          this.checkElements();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  checkElements() {
    this.elements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Element is in viewport
      if (rect.top < windowHeight * 0.85 && rect.bottom > 0) {
        element.classList.add('aos-animate');
      }
    });
  }
}

// ============================= 
// SMOOTH SCROLL FOR NAVIGATION
// ============================= 

class SmoothScroll {
  constructor() {
    this.init();
  }

  init() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        const href = anchor.getAttribute('href');

        // Skip empty anchors
        if (href === '#') {
          e.preventDefault();
          return;
        }

        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();

          // Calculate offset for fixed header
          const headerOffset = 100;
          const elementPosition = target.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      });
    });
  }
}

// ============================= 
// HEADER SHADOW ON SCROLL
// ============================= 

class HeaderEffects {
  constructor() {
    this.header = document.querySelector('header');
    this.init();
  }

  init() {
    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          this.updateHeader();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  updateHeader() {
    if (!this.header) return;
    if (window.scrollY > 50) {
      this.header.classList.add('header-scrolled');
    } else {
      this.header.classList.remove('header-scrolled');
    }
  }
}

// ============================= 
// PARALLAX EFFECT (SUBTLE)
// ============================= 

class ParallaxEffect {
  constructor() {
    this.heroSection = document.querySelector('.hero-section');
    if (!this.heroSection) return;

    this.init();
  }

  init() {
    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          this.updateParallax();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  updateParallax() {
    const scrolled = window.pageYOffset;

    // Only apply when hero is visible
    if (scrolled < window.innerHeight) {
      // Very subtle parallax - moves slower than scroll
      this.heroSection.style.transform = `translateY(${scrolled * 0.2}px)`;

      // Fade out as you scroll
      const opacity = Math.max(0, 1 - (scrolled / (window.innerHeight * 0.7)));
      this.heroSection.style.opacity = opacity;
    }
  }
}

// ============================= 
// FEATURE CARD TILT ON HOVER (OPTIONAL)
// ============================= 

class CardTiltEffect {
  constructor() {
    this.cards = document.querySelectorAll('.feature-card');
    this.init();
  }

  init() {
    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    this.cards.forEach(card => {
      card.addEventListener('mousemove', (e) => this.handleMouseMove(e, card));
      card.addEventListener('mouseleave', (e) => this.handleMouseLeave(e, card));
    });
  }

  handleMouseMove(e, card) {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Calculate rotation (very subtle - max 2 degrees)
    const rotateX = ((y - centerY) / centerY) * -1;
    const rotateY = ((x - centerX) / centerX) * 1;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
  }

  handleMouseLeave(e, card) {
    card.style.transform = '';
  }
}

// ============================= 
// ORNAMENTAL FLOURISH ANIMATIONS
// ============================= 

class OrnamentAnimations {
  constructor() {
    this.ornaments = document.querySelectorAll('.ornament-top svg, .ornament-bottom svg');
    this.init();
  }

  init() {
    // Fade in ornaments on load
    setTimeout(() => {
      this.ornaments.forEach((ornament, index) => {
        setTimeout(() => {
          ornament.style.opacity = '0.4';
          ornament.style.transition = 'opacity 1s ease';
        }, index * 200);
      });
    }, 500);
  }
}

// ============================= 
// PAGE LOAD FADE IN
// ============================= 

class PageTransition {
  constructor() {
    this.init();
  }

  init() {
    // Ensure page is visible on load
    document.body.style.opacity = '0';

    window.addEventListener('load', () => {
      setTimeout(() => {
        document.body.style.transition = 'opacity 0.8s ease';
        document.body.style.opacity = '1';
      }, 100);
    });
  }
}

// ============================= 
// INITIALIZE ALL SYSTEMS
// ============================= 

// ============================= 
// THEME TOGGLE (LIGHT / DARK)
// ============================= 

function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  const root = document.documentElement;
  if (!btn) return;

  function getTheme() {
    return root.getAttribute('data-theme') || 'light';
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    btn.setAttribute('title', theme === 'dark' ? 'Light theme' : 'Dark theme');
  }

  btn.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });

  setTheme(getTheme());
}

// ============================= 
// BACKGROUND AUDIO + MUTE TOGGLE
// ============================= 

function initAudioToggle() {
  const audio = document.getElementById('bgAudio');
  const btn = document.getElementById('audioToggle');
  if (!audio || !btn) return;

  // Start playback muted (allowed by autoplay policy); loop is set in HTML
  audio.loop = true;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => { });
  }

  function updateState() {
    const unmuted = !audio.muted;
    btn.classList.toggle('is-unmuted', unmuted);
    btn.setAttribute('aria-label', unmuted ? 'Mute background audio' : 'Unmute background audio');
    btn.setAttribute('title', unmuted ? 'Mute' : 'Unmute');
  }

  btn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (!audio.muted) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { });
    }
    updateState();
  });

  updateState();
}

// ============================= 
// SETTINGS MODAL
// ============================= 

function initSettingsModal() {
  const btn = document.getElementById('settingsBtn');
  const modal = document.getElementById('settingsModal');
  const closeBtn = document.getElementById('closeSettingsBtn');
  const cancelBtn = document.getElementById('cancelSettingsBtn');
  const form = document.getElementById('settingsForm');
  const openAlexInput = document.getElementById('settingOpenAlex');
  const groqInput = document.getElementById('settingGroq');
  const arxivInput = document.getElementById('settingArxiv');
  const statusEl = document.getElementById('settingsStatus');

  if (!btn || !modal) return;

  const openModal = async () => {
    modal.classList.remove('hidden');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
    }
    if (window.electronAPI?.settings?.get) {
      try {
        const s = await window.electronAPI.settings.get();
        if (s) {
          if (openAlexInput) openAlexInput.value = s.openalexApiKey || '';
          if (groqInput) groqInput.value = s.groqApiKey || '';
          if (arxivInput) arxivInput.value = s.arxivApiKey || '';
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
      }
    }
  };

  const closeModal = () => modal.classList.add('hidden');

  btn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  modal.querySelectorAll('.toggle-password-btn').forEach((toggleBtn) => {
    toggleBtn.addEventListener('click', () => {
      const targetInput = document.getElementById(toggleBtn.dataset.target);
      if (!targetInput) return;
      const isPass = targetInput.type === 'password';
      targetInput.type = isPass ? 'text' : 'password';
      toggleBtn.querySelector('.eye-open')?.classList.toggle('hidden', isPass);
      toggleBtn.querySelector('.eye-closed')?.classList.toggle('hidden', !isPass);
    });
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        openalexApiKey: openAlexInput ? openAlexInput.value.trim() : '',
        groqApiKey: groqInput ? groqInput.value.trim() : '',
        arxivApiKey: arxivInput ? arxivInput.value.trim() : '',
      };

      if (window.electronAPI?.settings?.save) {
        try {
          await window.electronAPI.settings.save(payload);
          if (statusEl) {
            statusEl.textContent = 'Settings saved.';
            statusEl.classList.remove('hidden');
          }
          setTimeout(closeModal, 600);
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = 'Error: ' + err.message;
            statusEl.classList.remove('hidden');
          }
        }
      } else {
        closeModal();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('📜 Classical European System Initialized');

  // Check if user prefers reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Core systems (always run)
  Router.init();       // SPA router + back/forward navigation
  initThemeToggle();
  new SmoothScroll();
  new HeaderEffects();
  initAudioToggle();
  initSettingsModal();

  // Visual systems (skip if reduced motion)
  if (!prefersReducedMotion) {
    new ScrollAnimations();
    new ParallaxEffect();
    new CardTiltEffect();
    new OrnamentAnimations();
    new PageTransition();
  } else {
    // Ensure elements are visible
    document.querySelectorAll('[data-aos]').forEach(el => {
      el.classList.add('aos-animate');
    });
    document.body.style.opacity = '1';
  }

  console.log('✨ All systems operational');
});


// ============================= 
// UTILITY: DEBOUNCE FUNCTION
// ============================= 

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ============================= 
// PRINT OPTIMIZATION
// ============================= 

window.addEventListener('beforeprint', () => {
  // Remove animations before printing
  document.querySelectorAll('[data-aos]').forEach(el => {
    el.classList.add('aos-animate');
  });
});

