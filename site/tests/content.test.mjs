import test from 'node:test';
import assert from 'node:assert/strict';
import { publicContent, escapeHTML, safeURL, validateContent } from '../content-model.mjs';

const seed = () => ({ profile: { name: '吴汉东', email: 'a@example.com' }, settings: {}, projects: [
  { id: 'b', slug: 'b', title: 'B', status: 'published', sortOrder: 3 },
  { id: 'draft', slug: 'draft', title: 'Secret draft', status: 'draft', sortOrder: 0 },
  { id: 'a', slug: 'a', title: 'A', status: 'published', sortOrder: 1 },
], education: [], experience: [], campus: [], honors: [], skills: [] });
test('public content excludes drafts and orders published projects', () => {
  const original = seed();
  const visible = publicContent(original);
  assert.deepEqual(visible.projects.map(p => p.id), ['a', 'b']);
  assert.equal(original.projects.length, 3);
  assert.ok(!JSON.stringify(visible).includes('Secret draft'));
});
test('rendered content is escaped and active URL schemes are rejected', () => {
  assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '../private.json']) assert.equal(safeURL(url), '');
  assert.equal(safeURL('media/uploads/cover.png'), 'media/uploads/cover.png');
  assert.equal(safeURL('https://github.com/Jenrimark'), 'https://github.com/Jenrimark');
});
test('duplicate slugs and invalid publication states cannot be published', () => {
  const d = seed(); d.projects[1].slug = 'b';
  assert.throws(() => validateContent(d), /slug/);
  d.projects[1].slug = 'draft'; d.projects[1].status = 'secret';
  assert.throws(() => validateContent(d), /status/);
});
test('valid content retains factual text without executing or inventing fields', () => {
  assert.equal(validateContent(seed()).profile.name, '吴汉东');
  assert.throws(() => validateContent({ projects: [] }), /profile/);
});
