// SVG icon helper — 20x20 stroke icons matching the site's design language
var TOOL_ICONS = {
  'bates-stamp': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  'filing-assembler': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M3 7V5a2 2 0 0 1 2-2h1"/></svg>',
  'redaction': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="4" rx="1" fill="currentColor" opacity="0.3"/><line x1="7" y1="15" x2="17" y2="15"/><line x1="7" y1="18" x2="13" y2="18"/></svg>',
  'metadata-stripper': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><circle cx="12" cy="15" r="0.5" fill="currentColor"/><path d="M5 12l3-3"/><path d="M5 9l3 3"/></svg>',
  'page-extractor': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
  'compressor': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 11v4"/><path d="M9 13h6"/><path d="M15 11l-3 6-3-6"/></svg>',
  'watermark': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M7 17l10-10" opacity="0.4"/><path d="M7 13l6-6" opacity="0.4"/><path d="M11 17l6-6" opacity="0.4"/></svg>',
  'pleading-paper': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/><line x1="6" y1="6" x2="6" y2="6.01"/><line x1="6" y1="10" x2="6" y2="10.01"/><line x1="6" y1="14" x2="6" y2="14.01"/><line x1="6" y1="18" x2="6" y2="18.01"/></svg>',
  'pfs-calculator': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="11" y2="10"/><line x1="13" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>'
};

// Tool registry — single source of truth for all tool metadata
const TOOLS = [
  {
    id: 'bates-stamp',
    name: 'Bates Stamper',
    description: 'Add Bates numbers, exhibit stamps, and confidentiality notices to PDFs',
    path: '/bates-stamp/',
    category: 'document',
    umamiEvent: 'stamp-document',
    flagship: true
  },
  {
    id: 'filing-assembler',
    name: 'Filing Assembler',
    description: 'Combine motion, exhibits, and slip sheets into one PDF ready to e-file',
    path: '/filing-assembler/',
    category: 'document',
    umamiEvent: 'assemble-filing'
  },
  {
    id: 'redaction',
    name: 'Privilege Redaction',
    description: 'Permanently redact sensitive content with labeled privilege reasons',
    path: '/redaction/',
    category: 'document',
    umamiEvent: 'redact-document'
  },
  {
    id: 'metadata-stripper',
    name: 'Metadata Stripper',
    description: 'Remove hidden author, dates, and edit history from PDFs before filing',
    path: '/metadata-stripper/',
    category: 'document',
    umamiEvent: 'strip-metadata'
  },
  {
    id: 'page-extractor',
    name: 'Page Extractor',
    description: 'Pull specific pages from a PDF for filing excerpts or partial exhibits',
    path: '/page-extractor/',
    category: 'document',
    umamiEvent: 'extract-pages'
  },
  {
    id: 'compressor',
    name: 'PDF Compressor',
    description: 'Reduce PDF file size to meet e-filing upload limits',
    path: '/compressor/',
    category: 'document',
    umamiEvent: 'compress-pdf'
  },
  {
    id: 'watermark',
    name: 'Document Watermark',
    description: 'Apply DRAFT, CONFIDENTIAL, or custom watermarks across PDF pages',
    path: '/watermark/',
    category: 'document',
    umamiEvent: 'watermark-document'
  },
  {
    id: 'pleading-paper',
    name: 'Pleading Paper',
    description: 'Generate numbered-line pleading paper for California, Federal, or custom courts',
    path: '/pleading-paper/',
    category: 'generator',
    umamiEvent: 'generate-pleading'
  },
  {
    id: 'pfs-calculator',
    name: 'PFS Calculator',
    description: 'Florida Statute 768.79 settlement threshold calculator',
    path: 'https://pfscalculator.com',
    category: 'calculator',
    external: true
  }
];

// Cross-tool suggestions: after using tool X, suggest tool Y
const TOOL_PIPELINE = {
  'bates-stamp': ['compressor', 'metadata-stripper'],
  'filing-assembler': ['bates-stamp', 'metadata-stripper', 'compressor'],
  'redaction': ['metadata-stripper'],
  'metadata-stripper': ['compressor'],
  'page-extractor': ['bates-stamp', 'watermark'],
  'compressor': [],
  'watermark': ['compressor'],
  'pleading-paper': []
};

// showPipelineSuggestions(currentToolId)
// Renders "Open your result in another tool" links after the #status element.
// Depends on TOOL_PIPELINE and TOOLS being defined (both declared above).
function showPipelineSuggestions(currentToolId) {
    if (typeof TOOL_PIPELINE === 'undefined' || typeof TOOLS === 'undefined') return;
    var suggestions = TOOL_PIPELINE[currentToolId];
    if (!suggestions || suggestions.length === 0) return;

    var html = '<div class="pipeline-suggestions">';
    html += '<p class="pipeline-title">Open your result in another tool:</p>';
    html += '<div class="pipeline-links">';

    for (var i = 0; i < suggestions.length; i++) {
        var toolId = suggestions[i];
        var tool = TOOLS.find(function(t) { return t.id === toolId; });
        if (tool) {
            html += '<a href="' + tool.path + '" class="pipeline-link">' + tool.name + ' &rarr;</a>';
        }
    }

    html += '</div></div>';

    var statusEl = document.getElementById('status');
    if (statusEl) {
        var existing = document.querySelector('.pipeline-suggestions');
        if (existing) existing.remove();
        statusEl.insertAdjacentHTML('afterend', html);
    }
}
