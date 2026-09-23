import type { HomepageRenderer } from './renderers/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function createRenderer(name: string, canvas: HTMLCanvasElement): Promise<HomepageRenderer> {
  switch (name) {
    case 'reaction-diffusion':
    case 'gray-scott': {
      const { createReactionDiffusionRenderer } = await import('./renderers/reaction-diffusion');
      return createReactionDiffusionRenderer(canvas);
    }
    default:
      throw new Error(`Unknown homepage renderer: ${name}`);
  }
}

class HomepageBackgroundElement extends HTMLElement {
  cleanup?: () => void;

  async connectedCallback() {
    if (this.dataset.enabled !== 'true') return;

    const canvas = this.querySelector<HTMLCanvasElement>('canvas');
    const poster = this.querySelector<SVGElement>('.homepage-field__poster');
    const field = this.querySelector<HTMLElement>('.homepage-field');
    const button = this.querySelector<HTMLButtonElement>('.homepage-motion-toggle');
    const status = this.querySelector<HTMLElement>('.homepage-field__status');
    const page = this.closest<HTMLElement>('.homepage-root');
    if (!canvas || !poster || !field || !button || !status || !page) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    const lowCapability = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(max-width:720px)').matches;
    const frameInterval = lowCapability ? 1000 / 10 : 1000 / 15;

    let renderer: HomepageRenderer | undefined;
    let frame = 0;
    let lastStep = 0;
    let lastPaint = 0;
    let visible = true;
    let paused = motion.matches;
    let manualChoice = false;
    let disposed = false;
    let pageTop = 0;
    let pageTravel = 1;

    const updateButton = () => {
      button.textContent = paused ? 'Play background' : 'Pause background';
      button.dataset.state = paused ? 'paused' : 'playing';
      button.setAttribute('aria-pressed', String(paused));
      canvas.dataset.motion = paused ? 'paused' : 'running';
      status.textContent = paused ? 'Reaction-diffusion field paused' : 'Reaction-diffusion field running';
    };

    const updateMetrics = () => {
      const rect = page.getBoundingClientRect();
      pageTop = window.scrollY + rect.top;
      pageTravel = Math.max(1, page.offsetHeight - innerHeight);
    };

    const updateScroll = () => {
      renderer?.setScroll(clamp((window.scrollY - pageTop) / pageTravel, 0, 1));
    };

    const tick = (now: number) => {
      if (!renderer || paused || !visible || document.hidden) return;
      frame = requestAnimationFrame(tick);
      if (now - lastPaint < frameInterval) return;
      const delta = lastStep ? Math.min((now - lastStep) / 1000, 0.08) : frameInterval / 1000;
      lastStep = now;
      lastPaint = now;
      renderer.step(delta);
      renderer.draw();
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastStep = 0;
      lastPaint = 0;
      updateButton();
      if (renderer && visible && !paused && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const toggle = () => {
      manualChoice = true;
      paused = !paused;
      renderer?.setReducedMotion(false);
      sync();
    };

    const handleMotionPreference = () => {
      if (motion.matches) {
        manualChoice = false;
        paused = true;
        renderer?.setReducedMotion(true);
      } else {
        renderer?.setReducedMotion(false);
        if (!manualChoice) paused = false;
      }
      sync();
    };

    const refreshTheme = () => {
      renderer?.refreshTheme();
      renderer?.draw();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      button.dataset.visible = visible ? 'true' : 'false';
      sync();
    });
    const resizeObserver = new ResizeObserver(() => {
      updateMetrics();
      renderer?.resize();
      updateScroll();
    });
    const themeObserver = new MutationObserver(refreshTheme);

    this.cleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll', updateScroll);
      motion.removeEventListener('change', handleMotionPreference);
      systemTheme.removeEventListener('change', refreshTheme);
      button.removeEventListener('click', toggle);
      renderer?.dispose();
    };

    try {
      renderer = await createRenderer(this.dataset.renderer || 'reaction-diffusion', canvas);
      if (disposed) {
        renderer.dispose();
        return;
      }
      canvas.hidden = false;
      poster.style.display = 'none';
      button.hidden = false;
      renderer.setReducedMotion(motion.matches);
      renderer.refreshTheme();
      updateMetrics();
      updateScroll();
      renderer.draw();

      observer.observe(page);
      resizeObserver.observe(field);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      document.addEventListener('visibilitychange', sync);
      window.addEventListener('scroll', updateScroll, { passive: true });
      motion.addEventListener('change', handleMotionPreference);
      systemTheme.addEventListener('change', refreshTheme);
      button.addEventListener('click', toggle);
      sync();
    } catch {
      renderer?.dispose();
      canvas.hidden = true;
      poster.style.display = '';
      button.hidden = true;
      status.textContent = 'Static reaction-diffusion field';
    }
  }

  disconnectedCallback() {
    this.cleanup?.();
  }
}

if (!customElements.get('homepage-background')) {
  customElements.define('homepage-background', HomepageBackgroundElement);
}
