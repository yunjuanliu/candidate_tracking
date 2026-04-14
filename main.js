import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://bvizbipdzkeccmhvoili.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2aXpiaXBkemtlY2NtaHZvaWxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTQ1ODMsImV4cCI6MjA5MTc3MDU4M30.O5si6602SoAYol3mGF9DIlLDAg_JPukYfV_0IuiXQ7o';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ────────────────────────────────────────────────────────────────────
let candidates = [];  // local cache, sorted by created_at desc
let editingId = null; // uuid of candidate being edited, or null for "add"

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function flashRow(id) {
  const row = document.getElementById(`row-${id}`);
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth; // force reflow to restart animation
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1000);
}

/** Extract Supabase Storage path from a public URL */
function storagePathFromUrl(url) {
  const marker = '/object/public/resumes/';
  const idx = url.indexOf(marker);
  return idx !== -1 ? decodeURIComponent(url.slice(idx + marker.length)) : null;
}

// ── Local cache ──────────────────────────────────────────────────────────────
function upsertLocal(candidate) {
  const idx = candidates.findIndex(c => c.id === candidate.id);
  if (idx === -1) {
    candidates.unshift(candidate); // new row: prepend (desc order)
  } else {
    candidates[idx] = candidate;
  }
}

function removeLocal(id) {
  candidates = candidates.filter(c => c.id !== id);
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  const container = document.getElementById('tableContainer');

  if (candidates.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <strong>No candidates yet</strong>
        <p>Click "Add Candidate" to get started.</p>
      </div>`;
    return;
  }

  const rows = candidates.map(c => {
    const statusClass = c.status === 'Done' ? 'done' : 'awaiting';
    const pdfCell = c.pdf_url
      ? `<div class="pdf-cell">
           <a class="pdf-link" href="${esc(c.pdf_url)}" target="_blank" rel="noopener"
              title="${esc(c.pdf_filename || 'Resume')}">
             📄 ${esc(c.pdf_filename || 'Resume')}
           </a>
           <label class="upload-btn" title="Replace PDF">
             ↑<input type="file" accept="application/pdf" data-id="${c.id}" class="pdf-input" />
           </label>
           <button class="btn-danger" data-delete-pdf="${c.id}" title="Remove PDF">✕</button>
         </div>`
      : `<label class="upload-btn">
           Upload PDF
           <input type="file" accept="application/pdf" data-id="${c.id}" class="pdf-input" />
         </label>`;

    return `<tr id="row-${c.id}">
      <td>${esc(c.name)}</td>
      <td>${esc(c.location)}</td>
      <td>${esc(c.current_job)}</td>
      <td>${esc(c.contact)}</td>
      <td>
        <select class="status-select ${statusClass}" data-id="${c.id}">
          <option value="Awaiting" ${c.status === 'Awaiting' ? 'selected' : ''}>Awaiting</option>
          <option value="Done"     ${c.status === 'Done'     ? 'selected' : ''}>Done</option>
        </select>
      </td>
      <td>${pdfCell}</td>
      <td>
        <button class="btn-icon"   data-edit="${c.id}">Edit</button>
        <button class="btn-danger" data-delete="${c.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Location</th>
          <th>Current Job</th>
          <th>Contact</th>
          <th>Status</th>
          <th>Resume</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Data ─────────────────────────────────────────────────────────────────────
async function loadCandidates() {
  const { data, error } = await db
    .from('candidates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { toast('Failed to load candidates'); console.error(error); return; }
  candidates = data ?? [];
  render();
}

// ── Realtime ─────────────────────────────────────────────────────────────────
function subscribeRealtime() {
  db.channel('candidates-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'candidates' }, ({ eventType, new: newRow, old: oldRow }) => {
      if (eventType === 'INSERT') {
        upsertLocal(newRow);
        render();
        flashRow(newRow.id);
      } else if (eventType === 'UPDATE') {
        upsertLocal(newRow);
        render();
        flashRow(newRow.id);
      } else if (eventType === 'DELETE') {
        removeLocal(oldRow.id);
        render();
      }
    })
    .subscribe();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(candidate = null) {
  editingId = candidate?.id ?? null;
  document.getElementById('modalTitle').textContent = candidate ? 'Edit Candidate' : 'Add Candidate';
  document.getElementById('fieldName').value     = candidate?.name        ?? '';
  document.getElementById('fieldLocation').value = candidate?.location    ?? '';
  document.getElementById('fieldJob').value      = candidate?.current_job ?? '';
  document.getElementById('fieldContact').value  = candidate?.contact     ?? '';
  document.getElementById('fieldStatus').value   = candidate?.status      ?? 'Awaiting';
  document.getElementById('overlay').classList.add('open');
  document.getElementById('fieldName').focus();
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  editingId = null;
}

async function saveModal() {
  const name = document.getElementById('fieldName').value.trim();
  if (!name) { toast('Name is required'); document.getElementById('fieldName').focus(); return; }

  const payload = {
    name,
    location:    document.getElementById('fieldLocation').value.trim(),
    current_job: document.getElementById('fieldJob').value.trim(),
    contact:     document.getElementById('fieldContact').value.trim(),
    status:      document.getElementById('fieldStatus').value,
  };

  const saveBtn = document.getElementById('modalSave');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const { error } = editingId
    ? await db.from('candidates').update(payload).eq('id', editingId)
    : await db.from('candidates').insert(payload);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  if (error) { toast('Save failed: ' + error.message); return; }

  // Optimistic update: reflect the change immediately without waiting for realtime echo
  if (editingId) {
    const existing = candidates.find(c => c.id === editingId);
    if (existing) upsertLocal({ ...existing, ...payload });
    render();
    flashRow(editingId);
  }
  // Inserts will arrive via realtime INSERT event — no optimistic needed

  closeModal();
  toast(editingId ? 'Candidate updated' : 'Candidate added');
}

// ── Status inline update ──────────────────────────────────────────────────────
async function updateStatus(id, status) {
  // Optimistic: update local cache immediately (dropdown class already swapped in handler)
  const existing = candidates.find(c => c.id === id);
  if (existing) upsertLocal({ ...existing, status });

  const { error } = await db.from('candidates').update({ status }).eq('id', id);
  if (error) {
    toast('Status update failed');
    // Revert optimistic change
    if (existing) upsertLocal(existing);
    render();
  }
}

// ── PDF ───────────────────────────────────────────────────────────────────────
async function uploadPdf(id, file) {
  const ext  = file.name.split('.').pop();
  const path = `${id}/${Date.now()}.${ext}`;

  toast('Uploading PDF…');

  const { error: upErr } = await db.storage
    .from('resumes')
    .upload(path, file, { upsert: true, contentType: 'application/pdf' });

  if (upErr) { toast('Upload failed: ' + upErr.message); return; }

  const { data: { publicUrl } } = db.storage.from('resumes').getPublicUrl(path);

  const { error: dbErr } = await db.from('candidates')
    .update({ pdf_url: publicUrl, pdf_filename: file.name })
    .eq('id', id);

  if (dbErr) { toast('Failed to save PDF link'); return; }

  // Optimistic update
  const existing = candidates.find(c => c.id === id);
  if (existing) { upsertLocal({ ...existing, pdf_url: publicUrl, pdf_filename: file.name }); render(); flashRow(id); }
  toast('PDF uploaded');
}

async function deletePdf(id) {
  const candidate = candidates.find(c => c.id === id);
  if (!candidate?.pdf_url) return;

  const storagePath = storagePathFromUrl(candidate.pdf_url);
  if (storagePath) await db.storage.from('resumes').remove([storagePath]);

  await db.from('candidates').update({ pdf_url: null, pdf_filename: null }).eq('id', id);

  // Optimistic update
  const c = candidates.find(x => x.id === id);
  if (c) { upsertLocal({ ...c, pdf_url: null, pdf_filename: null }); render(); }
  toast('PDF removed');
}

// ── Delete candidate ──────────────────────────────────────────────────────────
async function deleteCandidate(id) {
  if (!confirm('Delete this candidate? This cannot be undone.')) return;

  const candidate = candidates.find(c => c.id === id);
  if (candidate?.pdf_url) {
    const storagePath = storagePathFromUrl(candidate.pdf_url);
    if (storagePath) await db.storage.from('resumes').remove([storagePath]);
  }

  const { error } = await db.from('candidates').delete().eq('id', id);
  if (error) { toast('Delete failed'); return; }

  // Optimistic update: remove row immediately without waiting for realtime echo
  removeLocal(id);
  render();
  toast('Candidate deleted');
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCsv() {
  const headers = ['Name', 'Location', 'Current Job', 'Contact', 'Status', 'Resume URL'];
  const rows = candidates.map(c =>
    [c.name, c.location, c.current_job, c.contact, c.status, c.pdf_url ?? '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
  );

  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `candidates-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.getElementById('tableContainer').addEventListener('click', e => {
  const editBtn      = e.target.closest('[data-edit]');
  const deleteBtn    = e.target.closest('[data-delete]:not([data-delete-pdf])');
  const deletePdfBtn = e.target.closest('[data-delete-pdf]');

  if (editBtn)      openModal(candidates.find(c => c.id === editBtn.dataset.edit));
  else if (deleteBtn)    deleteCandidate(deleteBtn.dataset.delete);
  else if (deletePdfBtn) deletePdf(deletePdfBtn.dataset.deletePdf);
});

document.getElementById('tableContainer').addEventListener('change', e => {
  if (e.target.classList.contains('status-select')) {
    const { id } = e.target.dataset;
    const { value } = e.target;
    // Swap class immediately for instant visual feedback
    e.target.className = `status-select ${value === 'Done' ? 'done' : 'awaiting'}`;
    updateStatus(id, value);
  }
  if (e.target.classList.contains('pdf-input') && e.target.files[0]) {
    uploadPdf(e.target.dataset.id, e.target.files[0]);
  }
});

document.getElementById('addBtn').addEventListener('click', () => openModal());
document.getElementById('exportBtn').addEventListener('click', exportCsv);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalSave').addEventListener('click', saveModal);

document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', e => {
  const isOpen = document.getElementById('overlay').classList.contains('open');
  if (e.key === 'Escape' && isOpen) closeModal();
  if (e.key === 'Enter'  && isOpen) saveModal();
});

// ── Init ──────────────────────────────────────────────────────────────────────
await loadCandidates();
subscribeRealtime();
