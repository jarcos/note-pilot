// Safe Markdown -> HTML renderer. Pure: takes an `esc` (HTML-escape) function so
// it runs both in the browser (DOM-based esc) and in Node tests (string esc).
// Handles headings, bold/italic, NESTED ordered/unordered lists (indent-aware),
// and pipe tables. Never emits raw HTML from the source text.
(function (root) {
  function renderMarkdown(md, esc) {
    const inline = (t) => esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');

    const lines = (md || '').replace(/\t/g, '    ').split('\n');
    let html = '';
    const stack = []; // [{ type:'ul'|'ol', indent:Number }]
    let tableBuf = [];

    const closeAll = () => { while (stack.length) html += `</li></${stack.pop().type}>`; };
    const cellsOf = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
    const isSep = (cells) => cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
    const flushTable = () => {
      if (!tableBuf.length) return;
      const rows = tableBuf; tableBuf = [];
      let header = null, body = rows;
      if (rows.length >= 2 && isSep(cellsOf(rows[1]))) { header = rows[0]; body = rows.slice(2); }
      let t = '<table>';
      if (header) t += '<thead><tr>' + cellsOf(header).map((c) => `<th>${inline(c.trim())}</th>`).join('') + '</tr></thead>';
      t += '<tbody>' + body.map((r) => '<tr>' + cellsOf(r).map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      html += t;
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;

      if (/^\s*\|.*\|\s*$/.test(line)) { closeAll(); tableBuf.push(line); continue; }
      if (tableBuf.length) flushTable();

      if ((m = line.match(/^(#{1,3})\s*(\S.*)$/))) {
        closeAll();
        html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      } else if ((m = line.match(/^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/))) {
        const indent = m[1].length;
        const type = m[2] ? 'ol' : 'ul';
        const content = inline(m[3]);
        while (stack.length && indent < stack[stack.length - 1].indent) {
          html += `</li></${stack.pop().type}>`;
        }
        const top = stack[stack.length - 1];
        if (top && indent === top.indent) {
          if (top.type === type) {
            html += `</li><li>${content}`;
          } else {
            html += `</li></${stack.pop().type}>`;
            html += `<${type}><li>${content}`;
            stack.push({ type, indent });
          }
        } else {
          html += `<${type}><li>${content}`;
          stack.push({ type, indent });
        }
      } else if (line.trim() === '') {
        // blank line: keep lists open (loose lists)
      } else {
        closeAll();
        html += `<p>${inline(line)}</p>`;
      }
    }
    if (tableBuf.length) flushTable();
    closeAll();
    return html;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderMarkdown };
  } else {
    // Browser: provide a DOM-escape wrapper bound to window.renderMarkdown.
    const domEsc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    root.renderMarkdown = (md) => renderMarkdown(md, domEsc);
  }
})(typeof window !== 'undefined' ? window : globalThis);
