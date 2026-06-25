// Submit-time validation for the Admiralty-code dropdowns (issue #80).
//
// Rule: if a Reliability or Credibility *code* is set, the matching free-text
// description must be filled in before the draft can be Submitted. This holds
// for the file's own ratings and for every information row. Save is never
// gated — only Submit — so this helper is called from submitDraft (server,
// authoritative) and from the FileSidebar Submit button (client, to disable it
// and explain why). Returns a human-readable reason, or null when the snapshot
// is OK to submit.
//
// The argument is described structurally so this module stays free of the
// client/server FileDraftSnapshot imports (the test process can't load the
// client module); the real snapshot types are structurally compatible.

type RatedFields = {
  reliabilityCode: string | null;
  reliabilityText: string | null;
  credibilityCode: string | null;
  credibilityText: string | null;
};

type DraftLike = {
  metadata: {
    fileReliabilityCode: string | null;
    fileReliability: string | null;
    fileCredibilityCode: string | null;
    fileCredibility: string | null;
  };
  information: Array<{
    informationTitle: string;
    informationReliabilityCode: string | null;
    informationReliability: string | null;
    informationCredibilityCode: string | null;
    informationCredibility: string | null;
  }>;
};

function isBlank(value: string | null): boolean {
  return value == null || value.trim().length === 0;
}

function isSet(code: string | null): boolean {
  return code != null && code.trim().length > 0;
}

// Check one subject's reliability/credibility pair; `subject` names it for the
// message (e.g. "the file" or `Information "Title"`).
function checkRated(subject: string, f: RatedFields): string | null {
  if (isSet(f.reliabilityCode) && isBlank(f.reliabilityText)) {
    return `${subject} has a Reliability rating but no Reliability description.`;
  }
  if (isSet(f.credibilityCode) && isBlank(f.credibilityText)) {
    return `${subject} has a Credibility rating but no Credibility description.`;
  }
  return null;
}

// Returns the first blocking reason, or null when the draft may be submitted.
export function validateDraftForSubmit(draft: DraftLike): string | null {
  const fileReason = checkRated('The file', {
    reliabilityCode: draft.metadata.fileReliabilityCode,
    reliabilityText: draft.metadata.fileReliability,
    credibilityCode: draft.metadata.fileCredibilityCode,
    credibilityText: draft.metadata.fileCredibility,
  });
  if (fileReason) return fileReason;

  for (const info of draft.information) {
    const name = `Information "${info.informationTitle || 'Untitled'}"`;
    const reason = checkRated(name, {
      reliabilityCode: info.informationReliabilityCode,
      reliabilityText: info.informationReliability,
      credibilityCode: info.informationCredibilityCode,
      credibilityText: info.informationCredibility,
    });
    if (reason) return reason;
  }

  return null;
}
