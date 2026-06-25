// The Admiralty code (a.k.a. NATO source-evaluation system) used for the
// Reliability and Credibility dropdowns on files and information entries
// (issue #80). Reliability is an Alpha code A-F assessing the source;
// credibility a numeric code 1-6 assessing the item of information.
//
// `code` is what is stored in the database (nullable — blank means unrated);
// `label` is the short headline shown in the <option>; `description` is the
// full definition surfaced beneath the dropdown. One canonical list, shared by
// FileSidebar, InformationSidebar and the tests.

export type AdmiraltyOption = {
  code: string;
  label: string;
  description: string;
};

// Reliability of the source.
export const RELIABILITY_OPTIONS: AdmiraltyOption[] = [
  {
    code: 'A',
    label: 'Completely reliable',
    description:
      'No doubt of authenticity, trustworthiness, or competency; has a history of complete reliability.',
  },
  {
    code: 'B',
    label: 'Usually reliable',
    description:
      'Minor doubt about authenticity, trustworthiness, or competency; has a history of valid information most of the time.',
  },
  {
    code: 'C',
    label: 'Fairly reliable',
    description:
      'Doubt of authenticity, trustworthiness, or competency but has provided valid information in the past.',
  },
  {
    code: 'D',
    label: 'Not usually reliable',
    description:
      'Significant doubt about authenticity, trustworthiness, or competency but has provided valid information in the past.',
  },
  {
    code: 'E',
    label: 'Unreliable',
    description:
      'Lacking in authenticity, trustworthiness, and competency; history of invalid information.',
  },
  {
    code: 'F',
    label: 'Reliability cannot be judged',
    description:
      'No basis exists for evaluating the reliability of the source.',
  },
];

// Accuracy / credibility of the data.
export const CREDIBILITY_OPTIONS: AdmiraltyOption[] = [
  {
    code: '1',
    label: 'Confirmed by other sources',
    description:
      'Confirmed by other independent sources; logical in itself; consistent with other information on the subject.',
  },
  {
    code: '2',
    label: 'Probably true',
    description:
      'Not confirmed; logical in itself; consistent with other information on the subject.',
  },
  {
    code: '3',
    label: 'Possibly true',
    description:
      'Not confirmed; reasonably logical in itself; agrees with some other information on the subject.',
  },
  {
    code: '4',
    label: 'Doubtful',
    description:
      'Not confirmed; possible but not logical; no other information on the subject.',
  },
  {
    code: '5',
    label: 'Improbable',
    description:
      'Not confirmed; not logical in itself; contradicted by other information on the subject.',
  },
  {
    code: '6',
    label: 'Truth cannot be judged',
    description:
      'No basis exists for evaluating the validity of the information.',
  },
];

export const RELIABILITY_CODES = RELIABILITY_OPTIONS.map((o) => o.code);
export const CREDIBILITY_CODES = CREDIBILITY_OPTIONS.map((o) => o.code);

// Look up an option's description for the help line shown under a dropdown.
export function describeReliability(code: string | null): string | null {
  return RELIABILITY_OPTIONS.find((o) => o.code === code)?.description ?? null;
}

export function describeCredibility(code: string | null): string | null {
  return CREDIBILITY_OPTIONS.find((o) => o.code === code)?.description ?? null;
}
