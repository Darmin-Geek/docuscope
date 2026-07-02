// Shared definition of the search-scope model (issue #27). This module has no
// runtime dependencies, so it is safe to import from anywhere: client
// components, the API client wrapper, the route handler, and the Drizzle server
// layer all share this one source of truth for which fields exist.

export type SearchField =
  | 'author'
  | 'source'
  | 'fileBias'
  | 'fileReliability'
  | 'fileCredibility'
  | 'contents'
  | 'infoTitle'
  | 'infoText'
  | 'infoBias'
  | 'infoReliability'
  | 'infoCredibility';

export type SearchFieldGroup = {
  key: string;
  label: string;
  fields: { key: SearchField; label: string }[];
};

// The three searchable categories, each expandable into individual fields.
// The order here drives both the UI (grouped, expandable checkboxes) and the
// canonical field ordering used when serialising a scope.
export const SEARCH_FIELD_GROUPS: SearchFieldGroup[] = [
  {
    key: 'fileDetails',
    label: 'File details',
    fields: [
      { key: 'author', label: 'Author' },
      { key: 'source', label: 'Source' },
      { key: 'fileBias', label: 'Bias' },
      { key: 'fileReliability', label: 'Reliability' },
      { key: 'fileCredibility', label: 'Credibility' },
    ],
  },
  {
    key: 'contents',
    label: 'File contents',
    fields: [{ key: 'contents', label: 'PDF text' }],
  },
  {
    key: 'information',
    label: 'Information',
    fields: [
      { key: 'infoTitle', label: 'Title' },
      { key: 'infoText', label: 'Text' },
      { key: 'infoBias', label: 'Bias' },
      { key: 'infoReliability', label: 'Reliability' },
      { key: 'infoCredibility', label: 'Credibility' },
    ],
  },
];

export const ALL_SEARCH_FIELDS: SearchField[] = SEARCH_FIELD_GROUPS.flatMap((g) =>
  g.fields.map((f) => f.key),
);

const FIELD_SET = new Set<string>(ALL_SEARCH_FIELDS);

export function isSearchField(value: string): value is SearchField {
  return FIELD_SET.has(value);
}

/**
 * Parse a comma-separated `fields` query param into a validated, de-duplicated
 * list. Unknown keys are dropped. Returns `undefined` when the param is absent,
 * blank, or contains no recognised field — in every one of those cases the
 * caller falls back to searching everything (the default, back-compatible path).
 */
export function parseSearchFields(raw: string | null | undefined): SearchField[] | undefined {
  if (!raw) return undefined;
  const fields = Array.from(
    new Set(raw.split(',').map((s) => s.trim()).filter(isSearchField)),
  );
  return fields.length > 0 ? fields : undefined;
}
