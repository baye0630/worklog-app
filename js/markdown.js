/**
 * 轻量 Markdown 渲染（适配本应用生成的日报/周报）
 */
const MarkdownRender = (() => {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inline(text) {
    // 仅支持 **粗体**；不解析 _斜体_，避免文件名/SQL 中的 _ 被误渲染
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function render(md) {
    const lines = String(md || '').split('\n');
    const parts = [];
    let inUl = false;

    function closeUl() {
      if (inUl) {
        parts.push('</ul>');
        inUl = false;
      }
    }

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');

      if (line.startsWith('## ')) {
        closeUl();
        parts.push(`<h2>${inline(line.slice(3))}</h2>`);
        continue;
      }
      if (line.startsWith('### ')) {
        closeUl();
        parts.push(`<h3>${inline(line.slice(4))}</h3>`);
        continue;
      }
      if (line.startsWith('#### ')) {
        closeUl();
        parts.push(`<h4 class="md-h4">${inline(line.slice(5))}</h4>`);
        continue;
      }
      if (/^\d+\.\s/.test(line)) {
        closeUl();
        parts.push(`<p class="md-ol-item">${inline(line)}</p>`);
        continue;
      }
      if (line.startsWith('   - ')) {
        if (!inUl) {
          parts.push('<ul>');
          inUl = true;
        }
        parts.push(`<li>${inline(line.slice(5))}</li>`);
        continue;
      }
      if (line.startsWith('- ')) {
        if (!inUl) {
          parts.push('<ul>');
          inUl = true;
        }
        parts.push(`<li>${inline(line.slice(2))}</li>`);
        continue;
      }
      if (line.trim() === '') {
        closeUl();
        continue;
      }
      closeUl();
      parts.push(`<p>${inline(line)}</p>`);
    }
    closeUl();
    return parts.join('\n');
  }

  return { render };
})();
