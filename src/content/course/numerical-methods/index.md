---
title: "Numerical Methods in Astrophysics"
subtitle: "Graduate Lecture Notes"
description: "Practical numerical methods for astrophysical simulations: ODE integration, spectral methods, finite-volume schemes, N-body algorithms, and Monte Carlo techniques. Notes for the Part III course at the University of Cambridge."
course: "numerical-methods"
tags: ["graduate", "computing", "numerical methods"]
draft: false
---

These notes cover the core numerical algorithms used in modern astrophysical simulation codes.
The emphasis is on understanding *why* methods work — convergence, stability, conservation properties —
not just *how* to call them.

All examples are implemented in Python. Full notebooks are available on
[GitHub](https://github.com/yourusername/numerical-methods-notes).

## Topics

1. ODE integration — Runge-Kutta, symplectic integrators, adaptive timestepping
2. Spectral methods — Fourier transforms, Chebyshev polynomials, pseudospectral schemes
3. Finite volume methods — conservation laws, Riemann solvers, Godunov schemes

## Prerequisites

- Basic calculus and linear algebra
- Python (numpy, scipy, matplotlib)
- Some familiarity with classical mechanics