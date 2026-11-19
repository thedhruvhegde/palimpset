import { jpegExtractor } from '../extractors/jpeg/index.ts';
import { pngExtractor } from '../extractors/png/index.ts';
import { createRegistry } from './registry.ts';

/**
 * Default registry: images eager. PDF and DOCX register as lazy loaders when their specs land,
 * so pdfjs-dist, pdf-lib and jszip stay out of the initial web bundle.
 */
export const defaultRegistry = createRegistry({
  extractors: [pngExtractor, jpegExtractor],
  exorcists: [],
});
