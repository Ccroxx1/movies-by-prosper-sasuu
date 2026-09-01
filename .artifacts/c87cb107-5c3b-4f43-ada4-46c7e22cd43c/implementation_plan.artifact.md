# Modernization and Layout Fixes Plan

This plan addresses the design issues identified in the mobile layout, specifically the repeating brand content on movie details pages, the vertical clutter caused by large buttons, and the overall premium feel of the platform.

## User Review Required

> [!IMPORTANT]
> The SEO summary and top ad slot will now be hidden when viewing a specific movie's details. This ensures a cleaner, focused experience for the user but slightly reduces ad visibility on details pages (manual ad slots inside the details view will remain).

## Proposed Changes

### Structure & Visibility

#### [MODIFY] [index.html](file:///C:/Users/Sasuu/Downloads/MoviesByProsperSasuu-redesign/index.html)
- Move the `seo-summary` and `ad-slot-top` into the `homeView` section. This ensures they only appear on the browsing home page and are hidden when the user is viewing movie details or the watchlist.

---

### UI & Aesthetics Refinement

#### [MODIFY] [styles.css](file:///C:/Users/Sasuu/Downloads/MoviesByProsperSasuu-redesign/styles.css)
- **Action Buttons:** Update `.details-actions` to use a grid layout on mobile.
  - `Trailer` will remain full-width as the primary action.
  - `Watchlist`, `IMDb`, `Share`, and `Report` will be grouped into 2-column rows to save vertical space.
- **Torrent Cards:** Refine the typography and spacing of torrent entries for a more "data-rich" yet clean look.
- **Details Hero:** Add a subtle glassmorphism effect to the movie details panel for a more premium feel.
- **Tabs:** Improve the active state of tabs with a more distinct signature red highlight.
- **Padding:** Standardize section padding to ensure consistent breathing room across all views.

---

### Logic Updates

#### [MODIFY] [app.js](file:///C:/Users/Sasuu/Downloads/MoviesByProsperSasuu-redesign/app.js)
- Ensure the `detailsView` and `homeView` toggling correctly handles the new structure.
- Update `showGenresHub` to ensure the SEO summary is hidden when exploring genres specifically.

## Verification Plan

### Automated Tests
- Not applicable for this UI-focused layout change.

### Manual Verification
1.  **Mobile View:** Open a movie details page and verify the SEO summary is no longer at the top.
2.  **Button Layout:** Check that the action buttons are now in a 2-column grid instead of a long vertical list.
3.  **Responsiveness:** Verify the 960px breakpoint still functions correctly for the side menu.
4.  **Aesthetics:** Confirm the new button styles and torrent list layout look cohesive and "premium".
