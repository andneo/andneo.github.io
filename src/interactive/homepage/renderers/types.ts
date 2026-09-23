export interface HomepageRenderer {
  resize(): void;
  step(deltaSeconds: number): void;
  draw(): void;
  setPointer(x: number, y: number, active: boolean): void;
  setScroll(progress: number): void;
  setReducedMotion(reduced: boolean): void;
  refreshTheme(): void;
  dispose(): void;
}
