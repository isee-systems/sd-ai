import express from 'express';
import { execSync } from 'child_process';

function readVersion() {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const message = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
    const date = execSync('git log -1 --pretty=%cI', { encoding: 'utf8' }).trim();
    return { sha, message, date };
  } catch {
    return { sha: 'unknown', message: 'unknown', date: 'unknown' };
  }
}

const version = readVersion();

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const router = express.Router();

router.get('/version', (_req, res) => {
  const sha = escapeHtml(version.sha);
  const shortSha = escapeHtml(version.sha.slice(0, 7));
  const message = escapeHtml(version.message);
  const date = escapeHtml(version.date);

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>sd-ai version</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1.25rem; color: #222; }
  h1 { margin-bottom: 1.5rem; }
  dt { font-weight: 600; margin-top: 1rem; color: #555; }
  dd { margin: 0.25rem 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>sd-ai version</h1>
<dl>
  <dt>Commit ID</dt>
  <dd>${shortSha} <span style="color:#888">(${sha})</span></dd>
  <dt>Commit Date</dt>
  <dd>${date}</dd>
  <dt>Commit Message</dt>
  <dd>${message}</dd>
</dl>
</body>
</html>`);
});

export default router;
