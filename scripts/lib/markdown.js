'use strict';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function inline(value, rewriteLink) {
  let text = String(value);
  const chunks = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${chunks.length}@@`;
    chunks.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const next = rewriteLink ? rewriteLink(href) : href;
      const external = /^https?:\/\//.test(next);
      return `<a href="${escapeHtml(next)}"${external ? ' rel="noreferrer"' : ''}>${label}</a>`;
    });
  return text.replace(/@@CODE(\d+)@@/g, (_, index) => chunks[Number(index)]);
}

function uniqueSlug(title, used) {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

function closeList(stack, html) {
  while (stack.length) html.push(`</${stack.pop()}>`);
}

function renderMarkdown(source, options) {
  const rewriteLink = options && options.rewriteLink;
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const headings = [];
  const used = new Set();
  let inCode = false;
  let codeLang = '';
  let code = [];
  let paragraph = [];
  const listStack = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(' '), rewriteLink)}</p>`);
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushParagraph();
      closeList(listStack, html);
      if (inCode) {
        html.push(`<pre><code class="language-${escapeHtml(codeLang || 'text')}">${escapeHtml(code.join('\n'))}</code></pre>`);
        inCode = false;
        code = [];
        codeLang = '';
      } else {
        inCode = true;
        codeLang = fence[1] || 'text';
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList(listStack, html);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList(listStack, html);
      const level = heading[1].length;
      const title = heading[2].trim();
      const slug = uniqueSlug(title, used);
      headings.push({ level, title, slug });
      html.push(`<h${level} id="${slug}">${inline(title, rewriteLink)}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      closeList(listStack, html);
      html.push('<hr>');
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1])) {
      flushParagraph();
      closeList(listStack, html);
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        if (!/^:?-{3,}:?$/.test((cells[0] || '').replace(/\s/g, ''))) rows.push(cells);
        i += 1;
      }
      i -= 1;
      const header = rows.shift() || [];
      html.push('<table><thead><tr>');
      for (const cell of header) html.push(`<th>${inline(cell, rewriteLink)}</th>`);
      html.push('</tr></thead><tbody>');
      for (const row of rows) {
        html.push('<tr>');
        for (const cell of row) html.push(`<td>${inline(cell, rewriteLink)}</td>`);
        html.push('</tr>');
      }
      html.push('</tbody></table>');
      continue;
    }

    const list = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (list) {
      flushParagraph();
      const ordered = /\d+\./.test(list[2]);
      const tag = ordered ? 'ol' : 'ul';
      if (!listStack.length || listStack[listStack.length - 1] !== tag) {
        if (listStack.length && listStack[listStack.length - 1] !== tag) closeList(listStack, html);
        listStack.push(tag);
        html.push(`<${tag}>`);
      }
      html.push(`<li>${inline(list[3], rewriteLink)}</li>`);
      continue;
    }

    if (listStack.length && /^\s{2,}\S/.test(line)) {
      html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, ` ${inline(line.trim(), rewriteLink)}</li>`);
      continue;
    }

    closeList(listStack, html);
    paragraph.push(line.trim());
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushParagraph();
  closeList(listStack, html);
  return { html: html.join('\n'), headings };
}

module.exports = { escapeHtml, slugify, renderMarkdown };
