// Tool registry — single source of truth for all tool metadata
const TOOLS = [
  {
    id: 'bates-stamp',
    name: 'Bates Stamper',
    description: 'Add Bates numbers, exhibit stamps, and confidentiality notices to PDFs',
    path: '/bates-stamp/',
    icon: '#',
    category: 'document',
    umamiEvent: 'stamp-document',
    flagship: true
  },
  {
    id: 'filing-assembler',
    name: 'Filing Assembler',
    description: 'Combine motion, exhibits, and slip sheets into one PDF ready to e-file',
    path: '/filing-assembler/',
    icon: '📎',
    category: 'document',
    umamiEvent: 'assemble-filing'
  },
  {
    id: 'redaction',
    name: 'Privilege Redaction',
    description: 'Permanently redact sensitive content with labeled privilege reasons',
    path: '/redaction/',
    icon: '█',
    category: 'document',
    umamiEvent: 'redact-document'
  },
  {
    id: 'metadata-stripper',
    name: 'Metadata Stripper',
    description: 'Remove hidden author, dates, and edit history from PDFs before filing',
    path: '/metadata-stripper/',
    icon: '🔍',
    category: 'document',
    umamiEvent: 'strip-metadata'
  },
  {
    id: 'page-extractor',
    name: 'Page Extractor',
    description: 'Pull specific pages from a PDF for filing excerpts or partial exhibits',
    path: '/page-extractor/',
    icon: '📄',
    category: 'document',
    umamiEvent: 'extract-pages'
  },
  {
    id: 'compressor',
    name: 'PDF Compressor',
    description: 'Reduce PDF file size to meet e-filing upload limits',
    path: '/compressor/',
    icon: '📦',
    category: 'document',
    umamiEvent: 'compress-pdf'
  },
  {
    id: 'watermark',
    name: 'Document Watermark',
    description: 'Apply DRAFT, CONFIDENTIAL, or custom watermarks across PDF pages',
    path: '/watermark/',
    icon: '💧',
    category: 'document',
    umamiEvent: 'watermark-document'
  },
  {
    id: 'pleading-paper',
    name: 'Pleading Paper',
    description: 'Generate numbered-line pleading paper for California, Federal, or custom courts',
    path: '/pleading-paper/',
    icon: '📝',
    category: 'generator',
    umamiEvent: 'generate-pleading'
  },
  {
    id: 'pfs-calculator',
    name: 'PFS Calculator',
    description: 'Florida Statute 768.79 settlement threshold calculator',
    path: 'https://pfscalculator.com',
    icon: '🧮',
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
