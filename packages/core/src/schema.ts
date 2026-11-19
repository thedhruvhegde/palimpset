import { z } from 'zod';
import { GHOST_KINDS, SEVERITY_ORDER, type GhostLocation } from './types.ts';

export const FileKindSchema = z.enum(['png', 'jpeg', 'heic', 'pdf', 'docx', 'unknown']);
export const GhostKindSchema = z.enum(GHOST_KINDS);
export const SeveritySchema = z.enum(SEVERITY_ORDER as unknown as ['revenant', 'wraith', 'shade', 'wisp']);
const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const Offset = z.number().int().nonnegative();

export const GhostLocationSchema: z.ZodType<GhostLocation> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.literal('byte-range'), start: Offset, end: Offset }),
  z.object({ type: z.literal('chunk'), name: z.string(), start: Offset, end: Offset }),
  z.object({ type: z.literal('pdf-region'), page: z.number().int().nonnegative(), rect: RectSchema }),
  z.object({ type: z.literal('pdf-revision'), index: z.number().int().nonnegative(), start: Offset, end: Offset }),
  z.object({ type: z.literal('zip-entry'), path: z.string(), xpath: z.string().optional() }),
  z.object({ type: z.literal('nested'), container: GhostLocationSchema, inner: GhostLocationSchema, innerKind: FileKindSchema }),
])) as z.ZodType<GhostLocation>;

export const GhostSchema = z.object({
  id: z.string(),
  kind: GhostKindSchema,
  severity: SeveritySchema,
  title: z.string(),
  explanation: z.string(),
  location: GhostLocationSchema,
  evidence: z.object({
    summary: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    preview: z.object({ mime: z.enum(['image/png', 'image/jpeg']), bytes: z.instanceof(Uint8Array), width: z.number(), height: z.number() }).optional(),
    raw: z.unknown().optional(),
  }),
  confidence: z.number(),
});

export const WarningSchema = z.object({ code: z.string(), message: z.string(), offset: z.number().optional() });

/** What an extractor returns (before the orchestrator adds kind, size and duration). */
export const ExtractResultSchema = z.object({
  ghosts: z.array(GhostSchema),
  warnings: z.array(WarningSchema),
  unchecked: z.array(GhostKindSchema),
});

export const InspectionSchema = ExtractResultSchema.extend({
  kind: FileKindSchema,
  size: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
