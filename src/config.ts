// ─────────────────────────────────────────────────────────────────────────────
//  SITE CONFIGURATION
//  Edit this file to personalise your entire website.
//  Every page imports from here — you never need to hunt through multiple files.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTHOR = {
  name: "Andreas Neophytou",
  title: "Postdoc in Computational Soft Matter",                          // shown under name in hero
  institution: "Sapienza University of Rome",
  department: "Department of Physics",
  email: "andreas.neophytou@uniroma1.it",
  bio: `My research interests are generally in the realm of understanding programmable matter. 
  Get in touch if there's anything you see here that interests you or you want to share something interesting with me. 
  I believe in open science and try to contribute by sharing my <a href="/publications">papers</a>,
<a href="/post">blog posts</a>, and <a href="/course">lecture notes</a>.`,
  // Path to your photo — place the file in /public/images/
  avatar: "/images/avatar.jpg",
  // Path to your CV PDF — place the file in /public/files/
  cvPdf: "/files/cv.pdf",
};

export const SOCIAL = {
  github:        "https://github.com/andneo",
  // twitter:       "https://twitter.com/yourusername",  // or null to hide
  // linkedin:      "https://linkedin.com/in/yourname",  // or null to hide
  googleScholar: "https://scholar.google.com/citations?user=bkVn-kYAAAAJ&hl=en",
  // orcid:         "https://orcid.org/0000-0000-0000-0000",
  mastodon:      null,                                // or a URL
};

// Navigation links
// href starting with "#" scrolls to that section on the home page
// href starting with "/" goes to that page
export const NAV = [
  { label: "About",        href: "/#about" },
  { label: "Posts",        href: "/posts" },
  { label: "Publications", href: "/publications" },
  { label: "Research",     href: "/#research" },
  {
    label: "Courses",
    href: "#",   // dropdown — no direct link
    children: [
      // Add/remove course entries here; slugs must match /src/content/course/<slug>/
      // { label: "Stellar Dynamics",         href: "/course/stellar-dynamics/" },
      { label: "Statistical Mechanics",    href: "/course/statistical-mechanics/" },
      { label: "Numerical Methods",        href: "/course/numerical-methods/" },
    ],
  },
  { label: "CV",           href: "/cv/" },
  { label: "Contact",      href: "/#contact" },
];

// Home page — how many items to show in each section before "See all"
export const HOME_POST_COUNT        = 5;
export const HOME_PUBLICATION_COUNT = 3;
export const HOME_RESEARCH_COUNT    = 4;

// Contact section data
export const CONTACT = {
  location: "Cambridge, United Kingdom",
  office:   "Hoyle Building, Madingley Road",
  booking:  null,   // URL to a booking page, or null
};

// Accent colour (used for links and highlights)
// Change the hue to retheme the whole site (0=red, 210=blue, 140=green, 270=purple)
export const ACCENT_HUE = 215;
