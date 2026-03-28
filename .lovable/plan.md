

# Plan: Polish Admin Pages to Match Front-End Aesthetic

The goal is to bring Settings, Roles & Permissions, and Query Analytics up to the same clean, minimal, Apple-inspired standard as the landing/repository/assistant pages.

---

## 1. Settings Page

Minor refinements — already close:
- Add a page title with icon (like other admin pages have) between the Back button and the cards
- Soften card borders with `border-border/60 shadow-sm` to match the Roles page cards
- Consistent spacing

## 2. Roles & Permissions Page

### Roles Table (RolesPermissionsManager)
The table has 8 columns with Yes/No badges repeated 9 times per row — visually dense.

Changes:
- Collapse the three R/W/D badge columns per section into a single compact icon-based display (e.g., small colored dots or a condensed "RWD" text format like `R W ·` where enabled letters show and disabled ones are muted)
- Remove the API Tier column from the main table — it's an edge detail, visible in the edit dialog
- Remove the Description column from the main table — show it as a subtitle under the role name instead
- Reduce visual noise: lighter table header, more whitespace between rows
- The "Add Role" button gets a cleaner outline style

### Users Table (UsersRolesList)
- Remove the raw UUID display under user emails — it's not useful to admins
- Cleaner avatar circle styling
- Consistent card header styling with the Roles card

## 3. Query Analytics Page

### Top Section
- Remove the 3 disabled/non-functional buttons (Ground-Truth Eval, LLM Retrieval Eval, Eval History) — they add clutter with no functionality
- Move "Export CSV" to the top-right, inline with the page title (like the "Add Role" button pattern)
- Keep "SQL Reference Queries" as a subtle text link or small icon button, not a full button

### Analytics Cards
- Already clean — minor spacing/alignment pass only

### Confusion Matrix
- Reduce column count: combine TP/FP/FN/TN into a single compact column (e.g., `3/7/2/8` format) to free horizontal space
- Or: keep columns but use a tighter layout with smaller padding
- Add subtle row hover effect
- Aggregate row at bottom gets slightly more visual distinction (heavier top border, subtle background)
- The aggregate KPI tiles above the table are good — just align spacing with the analytics cards above

### LLM Retrieval Eval / Ground-Truth / Eval History sections
- These only render when data exists (on-demand) — leave as-is since they're rarely visible

---

## Files to Edit

| File | Changes |
|------|---------|
| `src/pages/Settings.tsx` | Add page title section, soften card styling |
| `src/components/RolesPermissionsManager.tsx` | Condense table columns (collapse R/W/D badges into compact format, remove Description + API Tier columns from table), cleaner header |
| `src/components/UsersRolesList.tsx` | Remove UUID, cleaner styling |
| `src/pages/QueryAnalytics.tsx` | Remove disabled buttons, move Export CSV to title row, tighten confusion matrix layout |
| `src/pages/AdminRoles.tsx` | Minor spacing consistency |

