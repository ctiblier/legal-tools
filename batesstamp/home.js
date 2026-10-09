// Initialize navigation
initNav({
    title: 'BatesStamp.com',
    subtitle: 'Free Legal Document Tools'
});

// Build tool grid from TOOLS registry
(function() {
    var grid = document.getElementById('toolGrid');
    if (!grid || typeof TOOLS === 'undefined') return;

    TOOLS.forEach(function(tool) {
        var card = document.createElement('a');
        card.href = tool.path;
        card.className = 'tool-card' + (tool.flagship ? ' flagship' : '') + (tool.external ? ' external' : '');
        if (tool.external) {
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
        }

        var externalBadge = tool.external ? '<span class="external-badge">Opens pfscalculator.com</span>' : '';
        var flagshipBadge = tool.flagship ? '<span class="flagship-badge">Most Popular</span>' : '';
        var iconSvg = (typeof TOOL_ICONS !== 'undefined' && TOOL_ICONS[tool.id]) || '';

        card.innerHTML =
            '<div class="tool-card-header">' +
                flagshipBadge +
                '<span class="tool-card-icon">' + iconSvg + '</span>' +
                '<h3>' + tool.name + '</h3>' +
            '</div>' +
            '<p>' + tool.description + '</p>' +
            externalBadge +
            '<span class="tool-card-cta">Use Tool &rarr;</span>';

        grid.appendChild(card);
    });
})();
