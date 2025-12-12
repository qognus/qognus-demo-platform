/**
 * web/js/tabs.js
 * Handles tab switching for any component with data-tab-group attributes.
 */
window.activateTabs = function (rootElement) {
  // 1. Find all tab groups inside the newly injected element
  const groups = rootElement.querySelectorAll('[data-tab-group]');
  
  if (groups.length === 0) {
    // Fallback: check if the root itself is the group (sometimes wrapper structure varies)
    if (rootElement.hasAttribute('data-tab-group')) {
        bindGroup(rootElement);
    }
    return;
  }

  groups.forEach(group => {
    bindGroup(group);
  });
};

function bindGroup(group) {
    const buttons = group.querySelectorAll('[data-tab-target]');
    const contents = group.querySelectorAll('[data-tab-content]');

    if (buttons.length === 0) {
        console.warn("[Tabs] Found group but no buttons:", group);
        return;
    }

    console.log(`[Tabs] Activating ${buttons.length} tabs in group:`, group.getAttribute('data-tab-group'));

    buttons.forEach(btn => {
      // Remove old listeners to prevent duplicates (if re-initialized)
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const targetName = newBtn.getAttribute('data-tab-target');

        // 1. Reset all Buttons in this group
        group.querySelectorAll('[data-tab-target]').forEach(b => {
          // Remove active styles (blue border, white text)
          b.classList.remove('border-sky-500', 'text-slate-50');
          // Add inactive styles
          b.classList.add('border-transparent', 'hover:text-slate-200');
        });

        // 2. Activate Clicked Button
        newBtn.classList.remove('border-transparent', 'hover:text-slate-200');
        newBtn.classList.add('border-sky-500', 'text-slate-50');

        // 3. Toggle Content Panels
        contents.forEach(content => {
          if (content.getAttribute('data-tab-content') === targetName) {
            content.classList.remove('hidden');
            // Small animation reset
            content.classList.remove('fade-in');
            void content.offsetWidth; // trigger reflow
            content.classList.add('fade-in');
          } else {
            content.classList.add('hidden');
          }
        });
      });
    });
}