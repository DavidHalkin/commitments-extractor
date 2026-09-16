import { z } from "zod";
import { EVENT_TYPES } from "@/lib/types";

const EvidenceRefSchema = z.object({
  utterance_id: z.string(),
  quote: z.string(),
});

const Agreement = z.enum(["agreed", "none", "disputed"]);

export const ExtractionSchema = z.object({
  speakers: z.array(
    z.object({
      speaker: z.number().int(),
      name: z.string().nullable(),
      intro_utterance_id: z.string().nullable(),
    }),
  ),
  no_commitments_discussed: z.boolean(),
  items: z.array(
    z.object({
      kind: z.enum(["task", "open_question"]),
      summary: z.string(),
      final_status: z.enum(["active", "cancelled", "not_accepted", "open"]),
      owner: z.object({
        status: Agreement,
        name: z.string().nullable(),
        evidence: EvidenceRefSchema.nullable(),
      }),
      deadline: z.object({
        status: Agreement,
        wording: z.string().nullable(),
        evidence: EvidenceRefSchema.nullable(),
        resolved_date: z.string().nullable(),
        anchor_utterance_id: z.string().nullable(),
      }),
      events: z.array(
        z.object({
          type: z.enum(EVENT_TYPES),
          utterance_id: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedItem = Extraction["items"][number];
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
