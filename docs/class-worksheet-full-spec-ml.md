# ക്ലാസ് വർക്ക് ഷീറ്റ് (Class WorkSheet) — പൂർണ്ണ പ്രൊഡക്റ്റ് രൂപരേഖ

## 1) ഉദ്ദേശ്യം
**Class WorkSheet** വിദ്യാലയ ഓഫീസിനും അധ്യാപകർക്കുമായി ഒരു **mini Excel workspace** ആയി പ്രവർത്തിക്കും. വിദ്യാർത്ഥി ഡാറ്റ (Attendance, Marks, Fees, Notes) ഒരിടത്ത് നിന്ന് വേഗത്തിൽ ക്രമീകരിച്ച്:
- A4-ready പ്രിന്റ് എടുക്കുക
- PDF ആയി സേവ് ചെയ്യുക
- യഥാർത്ഥ `.xlsx` എക്സ്പോർട്ട് ചെയ്യുക
- Template ആയി വീണ്ടും ഉപയോഗിക്കുക

---

## 2) പ്രധാന ഡിസൈൻ പ്രിൻസിപ്പിളുകൾ
1. **Excel-like familiarity** – സാധാരണ യൂസർക്ക് ട്രെയിനിംഗ് കൂടാതെ ഉപയോഗിക്കാം.
2. **Print-first architecture** – സ്ക്രീനിലും പ്രിന്റിലും ഒരേ fidelity.
3. **No-clutter toolbar** – context അടിസ്ഥാനമാക്കിയുള്ള relevant actions മാത്രം.
4. **Template-driven workflow** – ഒരിക്കൽ രൂപകൽപ്പന ചെയ്ത worksheet പല ക്ലാസ്സുകളിലും വീണ്ടും ഉപയോഗിക്കാൻ കഴിയണം.
5. **Fail-safe editing** – Undo/Redo + auto-save + unsaved warning.

---

## 3) വിവര ആർക്കിടെക്ചർ (Information Architecture)

## 3.1 Screen Layout (Top → Bottom)
1. **Ribbon (Home | Data | Page Layout)**
2. **Formula Bar + Name Box (A1, B4...)**
3. **Quick Actions Strip** (Save Template, Print Preview, Reset)
4. **Worksheet Canvas (A4-guided grid)**
5. **Status Bar** (Row/Col count, filter status, zoom)

## 3.2 Right-side Export Actions
- **PDF** (Red primary action)
- **Export Excel** (Green action)

---

## 4) UI/UX വിശദീകരണം

## 4.1 Ribbon – Home Tab
- Font family, size +/-
- Bold, Italic, Underline
- Text color / Fill color
- Horizontal alignment (Left/Center/Right)
- Wrap Text
- Insert / Delete (contextual: row/column/cell)
- Undo / Redo

## 4.2 Ribbon – Data Tab
- Auto Fill dropdown:
  - Student Name
  - Admission No
  - Roll No
  - Gender
  - Guardian Name
  - Phone
- Sort By:
  - Name A-Z / Z-A
  - Admission No
  - Roll No
- Group By:
  - Mixed
  - Boys First
  - Girls First
  - Separate Pages (with forced page break)
- Find / Replace (Phase-2)

## 4.3 Ribbon – Page Layout Tab
- Paper Size: A4 (locked default)
- Orientation: Portrait / Landscape
- Margins: Normal / Narrow / Wide (live preview)
- Header controls:
  - Show Official Header
  - Repeat on all pages
- Page breaks view toggle
- Fit-to-page options (1 page wide, auto height)

---

## 5) Worksheet Interactions (Excel-like)

1. **Cell/Row/Column selection**
   - Cell click → active green border
   - Column letter click → full column select
   - Row number click → full row select

2. **Keyboard support**
   - Arrow move, Enter, Shift+Enter, Tab
   - Multi-cell paste from Excel
   - Ctrl+C / Ctrl+V / Ctrl+X
   - Ctrl+Z / Ctrl+Y

3. **Formula bar sync**
   - Active cell reference + value edit

4. **Resize**
   - Drag column boundary to resize
   - New blank columns use fixed default width (configurable)

5. **Insert/Delete**
   - Insert Col / Delete Col
   - Insert Row / Delete Row
   - Prevent delete for locked system columns (S.No, Student Name if policy enabled)

---

## 6) പ്രീ-ഡിഫൈൻഡ് ഘടകങ്ങൾ

## 6.1 Fixed columns (default)
1. S.No (auto)
2. Student Name

## 6.2 Dynamic columns
- Blank column
- Custom heading column
- Attendance status column (P/A/L)
- Marks numeric column (0-100 validation)
- Fee status column (Paid/Pending/Partial)

---

## 7) Automation Rules
1. Class select ചെയ്താൽ roster auto-load
2. S.No auto-regenerate after sort/group/filter
3. Auto Fill applied only selected column or selected range
4. Duplicate heading warning
5. Empty heading fallback: `Column N`
6. Group By = Separate Pages ⇒ print engine inserts page break between groups

---

## 8) Print Engine Specifications
1. A4 canvas alignment (screen-to-print parity)
2. Header repeat per page (optional)
3. Print area excludes app chrome/ribbon when exporting PDF
4. Page numbers (optional footer)
5. Row cut prevention (avoid split row across pages if height permits)
6. Gridline and border contrast optimized for B/W printers

---

## 9) Export Specifications

## 9.1 PDF Export
- One-click export
- Current filters, grouping, page breaks respected
- Official header/logo embedded if enabled

## 9.2 Excel Export (.xlsx)
- Table data + column widths
- Header text + styles (where possible)
- Multi-page grouping mapped as section separators/sheets (config-based)

---

## 10) Template Management
1. Save as Template
2. Update existing template
3. Duplicate template
4. Default template per class
5. Template version history (Phase-2)

Template metadata:
- Template name
- Class applicability
- Created by / updated by
- Last used timestamp

---

## 11) Permissions Matrix
- **Admin/Office**: full create/edit/delete/export/print/template controls
- **Teacher**: class-scoped edit + print/export
- **Viewer**: read + print only

Optional guardrails:
- Lock specific columns from edit
- Lock rows after final approval

---

## 12) Validation & Error Handling
1. Max column limit (e.g., 200)
2. Character limit for headings (e.g., 60)
3. Numeric validations for marks/fees
4. Paste sanitizer (strip unsafe HTML/scripts)
5. Conflict warning on concurrent edits
6. Offline/poor network banner + retry queue

---

## 13) Performance Targets
- 2,000+ rows × 100 columns usable with virtualization
- Paste 5,000 cells under 2 seconds (target)
- PDF generation under 5 seconds for average class size

Techniques:
- Virtual scrolling
- Debounced formula-bar updates
- Batched state updates

---

## 14) Accessibility (A11y)
- Keyboard-first navigation
- High-contrast focus outline
- ARIA labels for ribbon actions
- Screen reader friendly table landmarks

---

## 15) Security & Audit
- Role-based access checks
- Server-side validation for exports
- Audit logs:
  - who changed what
  - timestamp
  - export events

---

## 16) Implementation Blueprint (Phased)

## Phase 1 (MVP)
- Core grid with fixed + dynamic columns
- Ribbon (basic Home/Data/Page Layout)
- Class roster autofill
- PDF + Excel export basic
- A4 print preview

## Phase 2
- Template save/duplicate/update
- Advanced grouping + separate pages
- Rich formatting parity improvements
- Audit logs

## Phase 3
- Version history
- Approval/lock workflow
- Performance tuning for very large datasets

---

## 17) Acceptance Criteria (UAT Checklist)
- [ ] Class select ⇒ correct students loaded
- [ ] Name Box & Formula Bar active cell sync
- [ ] Ctrl+C / Ctrl+V works with external Excel
- [ ] Drag resize persists for export
- [ ] Group by Separate Pages inserts page break correctly
- [ ] PDF output is clean A4 without ribbon/UI chrome
- [ ] Excel export opens without corruption
- [ ] Undo/Redo stack works after paste + delete + insert

---

## 18) Suggested “Ready-to-Build” API Contracts

### GET `/worksheet/roster?classId=...`
Returns student list and base fields.

### POST `/worksheet/template`
Create/update template JSON (layout, columns, print settings).

### POST `/worksheet/export/pdf`
Input: template + data snapshot. Output: PDF file URL/blob.

### POST `/worksheet/export/xlsx`
Input: template + data snapshot. Output: XLSX file URL/blob.

### POST `/worksheet/save`
Persists edited values + metadata.

---

## 19) Final Product Positioning
ഈ ടാബ് ഒരു simple table അല്ല; ഇത് **School Office-ready Spreadsheet Workflow Engine** ആകണം. അങ്ങനെ design ചെയ്താൽ attendance sheet, mark list, fee report, exam register എന്നിവ ഒരേ എൻജിനിൽ നിന്നു generate ചെയ്യാൻ കഴിയും.

---

## 20) Implementation Status (Updated)

### ✅ Phase-1 Completed in App
- Official portal-ൽ `Class Worksheet` tab ചേർത്തു.
- Class അടിസ്ഥാനമാക്കി roster auto-load.
- Sorting: Name A-Z, Admission No.
- Grouping: Mixed, Boys First, Girls First, Separate Pages.
- Formula bar + active cell green selection.
- Dynamic custom columns add/rename/edit.
- Insert/Delete basic operations:
  - Add Column / Delete selected custom column
  - Add Row / Delete selected row
- Undo / Redo (worksheet local history stack)
- Print flow (`window.print`) for PDF save.
- Excel-compatible export (CSV download)
- True `.xlsx` export (SheetJS-based) with CSV fallback
- Orientation + margin controls (UI + print-friendly spacing)
- Column drag-resize with width persistence (template save)
- Multi-cell clipboard paste (tab/newline matrix paste)
- Local template save/restore (browser storage)

### ⏭️ Next Stage (Advanced/Phase-2+)
- Backend template save/update API integration (shared across devices/users).
- Repeat-all-pages official header with institution logo in print engine.
- Full rich-style parity in XLSX export (cell colors/fonts/borders/merge behavior).
- Row virtualization/performance tuning for very large datasets.
