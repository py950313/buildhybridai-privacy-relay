export type EntityType =
  | 'PERSON' | 'ORG' | 'LOCATION' | 'ADDRESS' | 'EMAIL' | 'PHONE' | 'ID_NUMBER'
  | 'CARD' | 'ACCOUNT' | 'DATE_OF_BIRTH' | 'MEDICAL' | 'FINANCIAL' | 'OTHER';

export const ENTITY_TYPES: readonly EntityType[] = [
  'PERSON', 'ORG', 'LOCATION', 'ADDRESS', 'EMAIL', 'PHONE', 'ID_NUMBER',
  'CARD', 'ACCOUNT', 'DATE_OF_BIRTH', 'MEDICAL', 'FINANCIAL', 'OTHER',
];

export type SpanSource = 'regex' | 'gliner' | 'nano' | 'manual';

/** A detected stretch of the original text. Offsets are UTF-16 indices into the full input. */
export type Span = {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  source: SpanSource;
  reason?: string;
};

export type Entity = {
  id: string;
  type: EntityType;
  canonical: string;
  variants: string[];
  placeholder: string; // e.g. "[PERSON_1]"
};

export type Mention = Span & { entityId: string };

/** What a model layer returns: text only. Positions are always found by the program (locate.ts). */
export type RawItem = { text: string; type: EntityType; reason?: string };

export type Unlocated = RawItem & { source: SpanSource; chunkIndex: number };

export interface DetectionLayer {
  readonly source: Exclude<SpanSource, 'regex' | 'manual'>;
  detect(chunkText: string): Promise<RawItem[]>;
}

export type DetectionResult = {
  text: string;
  mentions: Mention[];
  entities: Entity[];
  unlocated: Unlocated[];
  warnings: string[];
};
