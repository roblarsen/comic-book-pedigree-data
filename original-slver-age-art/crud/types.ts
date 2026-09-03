import { isAltAsset, validateProvenanceLedger } from 'alt-asset-spec';
import type { OriginalComicArtAsset, ProvenanceEvent } from 'alt-asset-spec';

export type ComicArtPage = OriginalComicArtAsset;
export type SurvivalStatus = ComicArtPage['survivalStatus'];

const ISO_DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

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

    const ledgerValidation = validateProvenanceLedger(entry.provenanceLedger);
    if (!ledgerValidation.isValid) {
      throw new Error(
        `Invalid provenance ledger at index ${index}: ${ledgerValidation.errors.join('; ')}`
      );
    }

    entry.provenanceLedger.forEach((event, eventIndex) => {
      if (!ISO_DATE_PATTERN.test(event.date)) {
        throw new Error(
          `Invalid provenance event date at index ${index}, ledger item ${eventIndex}.`
        );
      }
    });

    return entry;
  });
}

export function parseProvenanceLines(raw: string, urn: string): ProvenanceEvent[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [notesPart, ...linkParts] = line.split('|').map((part) => part.trim());
      const sourceLink = linkParts.join('|').trim();

      return {
        eventId: `${urn}-event-${index + 1}`,
        eventType: 'exhibition',
        date: '1900-01-01',
        notes: notesPart,
        sourceLink: sourceLink || undefined,
      };
    });
}

export function provenanceLinesFromLedger(ledger: ProvenanceEvent[]): string {
  return ledger
    .map((event) => {
      if (event.sourceLink) {
        return `${event.notes ?? event.eventType} | ${event.sourceLink}`;
      }
      return event.notes ?? event.eventType;
    })
    .join('\n');
}

export function formatSurvivalStatus(status: SurvivalStatus): string {
  return status.replace(/_/g, ' ');
}
