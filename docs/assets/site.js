(() => {
  const toggle = document.querySelector('[data-nav-toggle]');
  const search = document.querySelector('[data-docs-search]');
  const results = document.querySelector('[data-search-results]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('nav-open');
    });
  }

  const indexUrl = document.documentElement.dataset.searchIndex;
  if (!search || !results || !indexUrl) return;

  let records = [];
  let loaded = false;
  let active = -1;

  async function loadIndex() {
    if (loaded) return records;
    const response = await fetch(indexUrl, { cache: 'no-store' });
    if (!response.ok) return [];
    records = await response.json();
    loaded = true;
    return records;
  }

  function render(matches) {
    results.innerHTML = '';
    results.classList.toggle('open', matches.length > 0);
    matches.slice(0, 12).forEach((item, index) => {
      const link = document.createElement('a');
      link.href = item.href;
      link.setAttribute('aria-selected', index === active ? 'true' : 'false');
      link.innerHTML = `<strong>${item.title}</strong><small>${item.summary || item.group || ''}</small>`;
      results.appendChild(link);
    });
  }

  function query(value) {
    const needle = value.trim().toLowerCase();
    if (!needle) {
      active = -1;
      render([]);
      return;
    }
    const scored = records.map(item => {
      const hay = `${item.title} ${item.summary} ${item.headings}`.toLowerCase();
      const hit = hay.includes(needle);
      const starts = item.title.toLowerCase().startsWith(needle);
      return { item, score: hit ? (starts ? 2 : 1) : 0 };
    }).filter(entry => entry.score).sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    if (active >= scored.length) active = scored.length - 1;
    render(scored.map(entry => entry.item));
  }

  search.addEventListener('focus', () => loadIndex());
  search.addEventListener('input', async () => {
    await loadIndex();
    query(search.value);
  });
  search.addEventListener('keydown', event => {
    const links = [...results.querySelectorAll('a')];
    if (event.key === 'Escape') {
      results.classList.remove('open');
      search.blur();
    } else if (event.key === 'ArrowDown' && links.length) {
      event.preventDefault();
      active = Math.min(links.length - 1, active + 1);
      links.forEach((link, index) => link.setAttribute('aria-selected', index === active ? 'true' : 'false'));
    } else if (event.key === 'ArrowUp' && links.length) {
      event.preventDefault();
      active = Math.max(0, active - 1);
      links.forEach((link, index) => link.setAttribute('aria-selected', index === active ? 'true' : 'false'));
    } else if (event.key === 'Enter' && links[Math.max(0, active)]) {
      event.preventDefault();
      location.href = links[Math.max(0, active)].href;
    }
  });
  document.addEventListener('click', event => {
    if (!results.contains(event.target) && event.target !== search) results.classList.remove('open');
  });
})();
