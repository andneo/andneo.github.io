# Quasi-2D network-water model: validation status

## Scope

Scene 02 is a *phenomenological* oxygen-network model with planar molecular-centre motion and three-dimensional rigid molecular rotation. It is **not** TIP4P, MB-pol, the machine-learning potential of Kapil *et al.*, or a quantitative prediction of the water phase diagram.

The following are scientific selection criteria, not display presets:

1. A differentiable, temperature-independent Hamiltonian shared by all pressure settings.
2. Conservative forces and torques verified by central finite differences.
3. Low-density three-connected honeycomb, intermediate-density three-/four-connected Cairo-pentagonal, and higher-density four-connected square networks all exist as dynamically accessible local minima.
4. Competing fixed-geometry enthalpies respond to external pressure through `U + P A w`, where `w=0.5 nm` is a **model confinement-width convention**.
5. Random starts and independent random seeds must be reported separately from the prepared-crystal stability tests; long-time equilibrium has not been established.

## Interaction terms

The effective energy comprises oxygen WCA excluded volume; a smooth, competing three-/four-coordinate oxygen-network term; directed, saturating donor-to-acceptor attractions; soft three-dimensional H–H exclusion; and three new cooperative terms.

- **Radial first-shell preference:** a smooth-cutoff attractive Gaussian centered at 0.282 nm, width 0.038 nm, depth 1.5 kJ/mol per oxygen pair.
- **Short-angle triplets:** `80 kJ/mol × w_ij w_ik × max(0, cos(theta_jik) − cos(80°))²`. This disfavors overcrowded acute angles without directly encoding polygons or crystal motifs.
- **Mixed-coordination cooperativity:** `−0.8 kJ/mol × Σ_(ij) w_ij [p4_i(1−p4_j)+p4_j(1−p4_i)]`, with `p4_i = 1 / (1 + exp(−10(c_i−3.5)))`, `c_i=Σ_j w_ij`. This biases contacts between locally three-/four-coordinate environments without prescribing pentagons.
- The relative offset of the fourfold basin is 6.7 kJ/mol per oxygen centre, with a threefold coordination stiffness of 8.0 kJ/mol.

The coefficients are exploratory and **not** fitted to bulk-water thermodynamics or ab-initio forces. No temperature-/pressure-dependent phase selector, geometry reset, or template insertion is used in normal MD.

## Published reference data

Kapil et al., *Nature* **609**, 512–516 (2022), DOI: [10.1038/s41586-022-05036-x](https://doi.org/10.1038/s41586-022-05036-x).

Structural configurations: [venkatkapil24/data-monolayer-confined-water-phase-diagram](https://github.com/venkatkapil24/data-monolayer-confined-water-phase-diagram/tree/main/phase-diagram/1_structures), released under CC BY-SA 4.0.

The 144-oxygen reference structures have approximate areal densities of 10.28 (hexagonal), 11.58 (pentagonal), and 12.54 (square) nm⁻². An oxygen-distance face tracer with cutoff 0.35 nm identifies 72 six-rings, 96 five-rings, and 144 four-rings respectively. This geometric tracer is separate from the directed hydrogen-bond display graph.

## Selection experiments

**Published-geometry test:** Reference oxygen coordinates and molecular orientations were reconstructed from the released XYZ configurations. With a *fixed* reference periodic cell, each candidate was evolved at 120 K for 320 MD steps. Counts below are geometric oxygen faces (before crystal / after MD):

| Configuration | Previous Hamiltonian | Cooperative Hamiltonian |
| --- | --- | --- |
| Hexagonal, six-rings | 52/72 | 71/72 |
| Pentagonal, five-rings | 80/96 | 96/96 |
| Square, four-rings | 136/144 | 144/144 |

**Independent self-contained regression:** Periodic honeycomb (144 sites), Cairo-pentagonal (144 sites) and square (144 sites) lattices were generated in code with **random initial water orientations**, then advanced for 400 MD steps at 120 K, approximately 0.03, 0.45 and 3 GPa. The characteristic ring counts remained 72/72, 96/96 and 144/144 respectively. These tests demonstrate local stability, not phase nucleation. Finite-difference force/torque checks on the candidate had maximum relative errors below `2e-7` for tested configurations.

**Fixed-configuration enthalpy screening:** Using the published reference areas and the model `P A w` convention, the cooperative Hamiltonian gives the lowest enthalpy among the three prepared geometries to hexagonal near 0.03 GPa, pentagonal near 0.45 GPa, and square near 1.5 GPa. This is **not** a free-energy calculation; vibrational/rotational entropy, relaxation, finite-size coexistence and hysteresis are not included.

**Random-start tests:** For 80 molecules and independent seeds 27182 and 31415, 1300 MD steps at 120 K did **not** produce clean hexagonal or pentagonal crystals at 0.03 or 0.45 GPa. High pressure (1.5–3 GPa) produced more square faces, with substantial defects. Extending low-pressure trajectories to 3400 steps or cooling from 500 to 120 K did not give reliable crystallization. **The requested robust spontaneous three-phase sampling has not yet been achieved.**

## Remaining limitations

- The 250-molecule simulation is still computationally heavy for interactive frame rates. The renderer adaptively chooses 1–3 full-force MD substeps from observed cost; it does not alter the potential or prescribe structures. As a result physical simulation time may advance slowly on mobile hardware.
- The pressure controller is a weak-coupling **isotropic-area** barostat, not a rigorous Gibbs NPT sampler. It estimates the pressure from `NkBT/A - dU/dA` at fixed fractional coordinates, using finite differences of the **same Hamiltonian** that supplies forces. The pressure unit conversion assumes a 0.5 nm confinement width.
- The cell **shape is fixed**, preserving the initial aspect ratio and shear fraction. The default 250-molecule box therefore remains square while its area changes. Prepared reference boxes retain their initial geometry under isotropic scaling. This removes unstable parallelogram drift but deliberately excludes spontaneous lattice-angle and anisotropic strain relaxation, which may affect polymorph stability and phase boundaries.
- The canvas renders on a fixed physical scale (pixels per nanometre), rather than re-zooming with the changing box. The UI reports areal density (nm⁻²), cell area (nm²), and percentage density change relative to the initial box. All these reflect the actual evolving simulation cell, not a pressure-to-density lookup.
- The oxygen-ring cutoff (0.35 nm) is a geometric diagnostic and can classify defects or transient contacts as rings; corroborate with persistent bonds, ring lifetimes, coordination, radial distributions and correlations.
- The high-pressure states still overcompress relative to the published square reference and are not free of short-angle defects.
- A clean crystalline phase in a **prepared** lattice is not evidence of spontaneous nucleation or equilibrium. To map phase boundaries, use multiple seeds, long equilibrated runs, independent crystalline and liquid starts, hysteresis/coexistence tests and, ideally, free-energy methods.

## Code locations

- `public/scripts/monolayer-md.js`: model, conservative forces, MD, graph and topology diagnostics, adaptive visualization.
- `tests/site.spec.ts`: finite-difference checks, seeded trajectories, lattice ring-retention and interface regressions.
- `src/components/research/WaterNetworkStory.astro`: user-facing explanation and controls.

No changes to Scene 01, `water-lens.js`, `water-md.js` or `main`.

## Fixed-shape pressure-coupling validation (subsequent correction)

An 80-molecule, 120 K pressure cycle starting at 1 GPa, moving to 6 GPa, then down to 0.03 GPa yielded areal densities of 10.845 → 13.514 → 10.498 nm⁻² (seed 27182) and 10.838 → 13.825 → 10.627 nm⁻² (seed 31415). Measurements were taken after 300, 550 and 900 MD steps at the respective settings; the final low-pressure states had not fully equilibrated. In both runs the default cell maintained aspect ratio 1 and shear 0. Density rose through molecular dynamics and pressure relaxation, not by directly mapping the pressure slider to density.

With independently generated 144-oxygen periodic lattices, 400-step trials retained 72/72 honeycomb six-rings, 95/96 Cairo five-rings and 144/144 square four-rings under isotropic pressure coupling. Unlike the earlier fixed-cell benchmarks, these runs allowed **area**, but not **shape**, to respond. These are local-stability diagnostics, not equilibrium phase calculations.

The fixed-shape controller requires validation against a rigorous constant-pressure ensemble if quantitative fluctuations, phase boundaries, anisotropic solid stresses, or shear deformation become important. The full Astro build and Playwright suite have not been executed as part of this correction.

## Expanded live explorer (400 molecules)

The Scene 02 browser explorer now initializes **400** molecules instead of 250, while retaining the same nominal starting areal density of **10.2800643033 nm⁻²**. Its initial area is therefore approximately **38.91 nm²** (previously **24.32 nm²**), a factor of 1.6 larger. The underlying `MonolayerWaterMD` constructor still defaults to 250 particles for independent validation and explicit-count tests.

To fill the available screen without scaling the physics anisotropically, the live explorer selects an initial rectangular periodic cell aspect ratio once from the available simulation region; it is subsequently held fixed by the isotropic barostat. A right-side region is reserved on desktop to avoid the controls; mobile frames are placed below the control overlay. Outer margins and the largest allowed low-density expansion are both respected. The live explorer uses a lower-density display/expansion limit of **8.5 nm⁻²** instead of the standalone model's **6.5 nm⁻²**, avoiding excessive zoom-out in the fixed-scale view. The pressure-driven cell area remains dynamically derived from the Hamiltonian and weak pressure controller, never assigned by a density lookup.

For a 1200×700 CSS-pixel stage the proposed initial box is approximately 715×579 pixels, with the region's maximum expansion fitting inside about 786×637 pixels. A 390×550 stage receives an initial projected box of about 326×260 pixels beneath the controls, with maximum expansion about 359×286 pixels.

Benchmark: one full MD step with 250 particles took about 16.8 ms versus 29.1 ms with 400 particles in the same JavaScript execution environment (45 timed steps after warmup). **This is not a browser frame-rate benchmark.** The adaptive 1–3-substep rendering policy remains unchanged; the 400-particle version may run slower, particularly on mobile hardware. Validation of all browsers and complete Playwright/Astro builds is still outstanding. The larger system does not by itself demonstrate spontaneous hexagonal or pentagonal crystallization.

## Temperature control and responsive layout correction

The stochastic BAOAB update uses the fluctuation–dissipation-consistent Ornstein–Uhlenbeck noise amplitude `sqrt(kBT (1 - exp(-2 gamma dt)) / mass)` for translational velocities and the corresponding moment-of-inertia expression for rotational velocities. The user-reported anomalous appearance was traced partly to transient **potential-energy release** from strained random initial states. With the former translational friction `gamma=1.15`, a test initially targeting 120 K exceeded 1900 K translational kinetic temperature after 30 steps; the rotational kinetic temperature was much closer to its target. This is **not** evidence that the OU noise formula is wrong.

The model now uses translational `gamma=8` after a 160-step damping ramp starting at `gamma=32`. The noise amplitude is recalculated with that same instantaneous friction, preserving the intended Langevin stationary kinetic distribution for each constant-friction segment. Direct rescaling of all linear/angular velocities when a user changes temperature was removed. The model exposes separate instantaneous kinetic-temperature estimators and smoothed readouts for **2(N−1)** relative planar translational and **3N** rigid rotational DOFs. Values can fluctuate around the target; an `equilibrating` indicator identifies the temporary friction ramp. This improves the early kinetic transient but is not proof of full configurational equilibration.

Focused numerical check, **400 molecules**, initial aspect ratio 1.25, pressure target 1 GPa, 300 MD steps, random seed 1717, kinetic statistics averaged over 12 samples after step 200:

| Bath target | Mean translational kinetic T | Mean rotational kinetic T |
| --- | ---: | ---: |
| 120 K | 132.3 K | 120.6 K |
| 500 K | 500.0 K | 499.1 K |

These are short, correlated measurements, not independent uncertainty estimates or long-time thermodynamic averages. The simulated melting/crystallization phase behavior remains unvalidated.

The camera now uses the **actual current bounding rectangles** of the thermo panel and chapter-navigation controls to choose an unobstructed region within the responsive stage. It takes the largest allowed physical box area, uses one uniform pixels-per-nm scale, and adjusts only camera translation/scale when the browser window changes. Molecular coordinates, number density, cell shape, barostat state and Hamiltonian are not modified on window resize. A mobile Scene 02 stage minimum height of 700 CSS px prevents the panel from squeezing the simulation into a very narrow area. Geometry spot-checks with synthetic stage/control rectangles from 375 to 1440 CSS px width found no overlap or box clipping in the tested cases.

**Limitations:** These checks were performed using source-level JavaScript and simulated viewport geometry; the complete browser Playwright suite and Astro production build have not been run. The friction ramp is a transient equilibration aid, not exact NPT/NVT sampling, and a dynamic resizing camera does not resize the *physical* simulation cell.
