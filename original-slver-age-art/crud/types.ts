export type ArtStatus = 'Verified' | 'Complete' | 'Backup Only' | 'Ghost';

export interface ProvenanceRecord {
  label: string;
  url?: string;
}

export interface ArtCensusEntry {
  id: string;
  seriesTitle: string;
  issueDisplay: string;
  issueNumbers: number[];
  status: ArtStatus;
  description: string;
  artists: string[];
  provenance: ProvenanceRecord[];
}