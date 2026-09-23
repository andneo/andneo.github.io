import type { FieldRect, HomepageRenderer } from './renderers/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function createRenderer(name: string, canvas: HTMLCanvasElement): Promise<HomepageRenderer> {
  switch (name) {
    case 'cahn-hilliard':
    case 'phase-field': {
      const { createCahnHilliardRenderer } = await import('./renderers/cahn-hilliard');
      return createCahnHilliardRenderer(canvas);
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
    const page = this.closest<HTMLElement>('.homepage-root');
    if (!canvas || !poster || !field || !page) return;

    const quietTargets = [...page.querySelectorAll<HTMLElement>('[data-field-quiet]')];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    const lowCapability = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(max-width:720px)').matches;
    const frameInterval = lowCapability ? 1000 / 8 : 1000 / 12;

    let renderer: HomepageRenderer | undefined;
    let frame = 0;
    let scrollFrame = 0;
    let lastStep = 0;
    let lastPaint = 0;
    let visible = true;
    let paused = motion.matches;
    let disposed = false;
    let pageTop = 0;
    let pageTravel = 1;

    const quietRects = (): FieldRect[] =>
      quietTargets
        .map(target => target.getBoundingClientRect())
        .filter(rect => rect.bottom > -120 && rect.top < innerHeight + 120)
        .map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }));

    const updateMetrics = () => {
      const rect = page.getBoundingClientRect();
      pageTop = window.scrollY + rect.top;
      pageTravel = Math.max(1, page.offsetHeight - innerHeight);
      const rects = quietRects();
      canvas.dataset.quietZones = String(rects.length);
      renderer?.setQuietZones(rects);
    };

    const updateScroll = () => {
      scrollFrame = 0;
      if (!renderer) return;
      renderer.setScroll(clamp((window.scrollY - pageTop) / pageTravel, 0, 1));
      const rects = quietRects();
      canvas.dataset.quietZones = String(rects.length);
      renderer.setQuietZones(rects);
    };

    const tick = (now: number) => {
      if (!renderer || paused || !visible || document.hidden) return;
      frame = requestAnimationFrame(tick);
      if (now - lastPaint < frameInterval) return;
      const delta = lastStep ? Math.min((now - lastStep) / 1000, 0.12) : frameInterval / 1000;
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
      canvas.dataset.motion = paused ? 'static' : 'running';
      if (renderer && visible && !paused && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const handleMotionPreference = () => {
      paused = motion.matches;
      renderer?.setReducedMotion(paused);
      sync();
    };

    const refreshTheme = () => {
      renderer?.refreshTheme();
      renderer?.draw();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      sync();
    });

    const resizeObserver = new ResizeObserver(() => {
      renderer?.resize();
      updateMetrics();
      updateScroll();
    });

    const themeObserver = new MutationObserver(refreshTheme);

    const handleScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(updateScroll);
    };

    this.cleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      observer.disconnect();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll', handleScroll);
      motion.removeEventListener('change', handleMotionPreference);
      systemTheme.removeEventListener('change', refreshTheme);
      renderer?.dispose();
    };

    try {
      renderer = await createRenderer(this.dataset.renderer || 'cahn-hilliard', canvas);
      if (disposed) {
        renderer.dispose();
        return;
      }

      canvas.hidden = false;
      poster.style.display = 'none';
      renderer.setReducedMotion(motion.matches);
      renderer.refreshTheme();
      updateMetrics();
      updateScroll();
      renderer.draw();

      observer.observe(page);
      resizeObserver.observe(field);
      quietTargets.forEach(target => resizeObserver.observe(target));
      themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
      document.addEventListener('visibilitychange', sync);
      window.addEventListener('scroll', handleScroll, { passive:true });
      motion.addEventListener('change', handleMotionPreference);
      systemTheme.addEventListener('change', refreshTheme);
      sync();
    } catch {
      renderer?.dispose();
      canvas.hidden = true;
      poster.style.display = '';
    }
  }

  disconnectedCallback() {
    this.cleanup?.();
  }
}

if (!customElements.get('homepage-background')) {
  customElements.define('homepage-background', HomepageBackgroundElement);
}
