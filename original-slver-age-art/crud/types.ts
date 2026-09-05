import { isAltAsset, validateProvenanceLedger } from 'alt-asset-spec';
import type { OriginalComicArtAsset } from 'alt-asset-spec';

export const PROVENANCE_EVENT_TYPES = [
  'auction',
  'private_sale',
  'dealer_record',
  'exhibition',
  'private_collection',
  'publication',
] as const;

export type ProvenanceEventType = (typeof PROVENANCE_EVENT_TYPES)[number];

export interface ProvenanceEvent {
  eventId: string;
  eventType: ProvenanceEventType;
  date: string;
  notes?: string;
  sourceLink?: string;
}

export type ComicArtPage = Omit<OriginalComicArtAsset, 'provenanceLedger'> & {
  provenanceLedger: ProvenanceEvent[];
};
export type SurvivalStatus = ComicArtPage['survivalStatus'];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isProvenanceEventType = (value: string): value is ProvenanceEventType =>
  PROVENANCE_EVENT_TYPES.includes(value as ProvenanceEventType);

const isValidIsoDate = (value: string): boolean => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function createProvenanceEventId(urn: string, index: number): string {
  return `${urn}-event-${index + 1}`;
}

export function sanitizeProvenanceLedger(
  rawLedger: unknown,
  urn: string,
  survivalStatus: SurvivalStatus
): ProvenanceEvent[] {
  if (survivalStatus === 'unconfirmed' || !Array.isArray(rawLedger)) {
    return [];
  }

  return rawLedger
    .map((rawEvent, index): ProvenanceEvent | null => {
      if (!rawEvent || typeof rawEvent !== 'object') return null;

      const candidate = rawEvent as Record<string, unknown>;
      const eventTypeValue = cleanString(candidate.eventType);
      const dateValue = cleanString(candidate.date);
      const notesValue = cleanString(candidate.notes);
      const sourceLinkValue = cleanString(candidate.sourceLink);
      const eventIdValue = cleanString(candidate.eventId) ?? createProvenanceEventId(urn, index);

      if (!eventTypeValue || !isProvenanceEventType(eventTypeValue) || !dateValue || !isValidIsoDate(dateValue)) {
        return null;
      }

      if (!notesValue && !sourceLinkValue) {
        return null;
      }

      return {
        eventId: eventIdValue,
        eventType: eventTypeValue,
        date: dateValue,
        notes: notesValue,
        sourceLink: sourceLinkValue,
      };
    })
    .filter((event): event is ProvenanceEvent => event !== null);
}

const isOriginalArtRecord = (value: unknown): value is ComicArtPage => {
  if (!isAltAsset(value) || value.assetClass !== 'original_art') {
    return false;
  }

  const record = value as ComicArtPage;

  if (!record.publicationTarget || !record.artDetails) {
    return false;
  }

  const hasPublicationFields =
    typeof record.publicationTarget.publisher === 'string' &&
    typeof record.publicationTarget.seriesTitle === 'string' &&
    typeof record.publicationTarget.issueNumber === 'number' &&
    Array.isArray(record.publicationTarget.storyPageNumbers) &&
    record.publicationTarget.storyPageNumbers.every((n) => typeof n === 'number');

  const hasArtDetailFields =
    typeof record.artDetails.workType === 'string' &&
    Array.isArray(record.artDetails.creators) &&
    record.artDetails.creators.every(
      (creator) =>
        creator && typeof creator.name === 'string' && typeof creator.role === 'string'
    );

  const hasSurvivalStatus =
    record.survivalStatus === 'verified' ||
    record.survivalStatus === 'complete_intact' ||
    record.survivalStatus === 'dispersed' ||
    record.survivalStatus === 'unconfirmed';

  return hasPublicationFields && hasArtDetailFields && hasSurvivalStatus;
};

export function parseComicArtPages(value: unknown): ComicArtPage[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid format: Root of JSON must be an array.');
  }

  return value.map((entry, index) => {
    if (!isOriginalArtRecord(entry)) {
      throw new Error(`Invalid original_art record at index ${index}.`);
    }

    const normalizedEntry: ComicArtPage = {
      ...entry,
      provenanceLedger: sanitizeProvenanceLedger(
        entry.provenanceLedger,
        entry.urn,
        entry.survivalStatus
      ),
    };

    const ledgerValidation = validateProvenanceLedger(normalizedEntry.provenanceLedger);
    if (!ledgerValidation.isValid) {
      throw new Error(
        `Invalid provenance ledger at index ${index}: ${ledgerValidation.errors.join('; ')}`
      );
    }

    normalizedEntry.provenanceLedger.forEach((event, eventIndex) => {
      if (!isValidIsoDate(event.date)) {
        throw new Error(
          `Invalid provenance event date at index ${index}, ledger item ${eventIndex}.`
        );
      }
    });

    return normalizedEntry;
  });
}

export function formatSurvivalStatus(status: SurvivalStatus): string {
  return status.replace(/_/g, ' ');
}
