"use client";

import { type FileDoc, type Label } from "@/lib/projects";
import { type SearchField } from "@/lib/searchScope";
import LabelPill from "./LabelPill";
import SearchScopeMenu from "./SearchScopeMenu";

type FilesTableProps = {
  files: FileDoc[];
  loading: boolean;
  error: string | null;
  // The project's labels, used to render each file's label ids as pills.
  labels: Label[];
  // The currently open file (highlighted), or null when the sidebar is closed.
  selectedId: string | null;
  onSelectFile: (file: FileDoc) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  // Which fields the search covers (issue #27), and a setter for the scope menu.
  searchScope: Set<SearchField>;
  onSearchScopeChange: (next: Set<SearchField>) => void;
};

// `createdDate` is a unix timestamp (seconds) the user enters, or null when
// unset (see docs/dataModel.md). Render blank cells for any missing value.
function formatDate(createdDate: number | null): string {
  if (createdDate == null) return "";
  return new Date(createdDate * 1000).toLocaleDateString();
}

export default function FilesTable({
  files,
  loading,
  error,
  labels,
  selectedId,
  onSelectFile,
  searchQuery,
  onSearchChange,
  searchScope,
  onSearchScopeChange,
}: FilesTableProps) {
  const labelsById = new Map(labels.map((label) => [label.id, label]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-stretch gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files…"
          aria-label="Search files"
          className="w-full rounded-full border border-black/[.08] bg-transparent px-4 py-2 text-sm text-black placeholder-zinc-400 outline-none focus:border-black/30 dark:border-white/[.145] dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-white/30"
        />
        <SearchScopeMenu scope={searchScope} onChange={onSearchScopeChange} />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading files…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {searchQuery.trim() ? "No files match your search." : "No files yet."}
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-black/[.08] dark:border-white/[.145]">
              <th className="py-2 pr-4 font-semibold text-black dark:text-zinc-50">
                Name
              </th>
              <th className="py-2 pr-4 font-semibold text-black dark:text-zinc-50">
                Author
              </th>
              <th className="py-2 pr-4 font-semibold text-black dark:text-zinc-50">
                Date Created
              </th>
              <th className="py-2 font-semibold text-black dark:text-zinc-50">
                Labels
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.id}
                onClick={() => onSelectFile(file)}
                className={`cursor-pointer border-b border-black/[.04] hover:bg-black/[.04] dark:border-white/[.06] dark:hover:bg-white/[.06] ${
                  file.id === selectedId ? "bg-black/[.04] dark:bg-white/[.06]" : ""
                }`}
              >
                <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                  {file.filename}
                </td>
                <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                  {file.author ?? ""}
                </td>
                <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                  {formatDate(file.createdDate)}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {file.labels.map((labelId) => {
                      const label = labelsById.get(labelId);
                      if (!label) return null;
                      return (
                        <LabelPill
                          key={labelId}
                          label={label.label}
                          color={label.color}
                        />
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
