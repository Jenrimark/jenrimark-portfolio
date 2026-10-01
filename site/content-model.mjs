export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function safeURL(value = '') {
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) { try { const u = new URL(v); return u.username || u.password ? '' : u.href; } catch { return ''; } }
  return /^media\/[a-zA-Z0-9_./-]+$/.test(v) && !v.includes('..') ? v : '';
}
export function validateContent(data) {
  if (!data || typeof data !== 'object' || !data.profile || typeof data.profile.name !== 'string' || !data.profile.name.trim()) throw new Error('profile.name is required');
  if (!Array.isArray(data.projects) || data.projects.length > 100) throw new Error('projects must be an array (max 100)');
  const slugs = new Set();
  for (const p of data.projects) {
    if (!p || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || '') || slugs.has(p.slug)) throw new Error('project slug must be unique and use lowercase letters/numbers');
    slugs.add(p.slug);
    if (!p.title || typeof p.title !== 'string' || p.title.length > 150) throw new Error('project title is required (max 150)');
    if (!['draft', 'published'].includes(p.status)) throw new Error('project status must be draft or published');
    if (p.cover && !safeURL(p.cover)) throw new Error('invalid project cover URL');
  }
  for (const k of ['education', 'experience', 'campus', 'honors', 'skills']) if (data[k] != null && !Array.isArray(data[k])) throw new Error(`${k} must be an array`);
  if (JSON.stringify(data).length > 1_500_000) throw new Error('content is too large');
  return data;
}
export function publicContent(data) {
  validateContent(data);
  const copy = structuredClone(data);
  copy.projects = copy.projects.filter(p => p.status === 'published').sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  return copy;
}
