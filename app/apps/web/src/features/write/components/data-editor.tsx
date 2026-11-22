"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, inputClass } from "@/features/write/components/ui";
import {
  type Draft,
  fieldsFor,
  type Granularity,
  type Kind,
  type SourceCaskRow,
} from "@/features/write/lib/draft";

/** Form for the envelope's `data`: the cask or bottle field set, plus quantity and unit for batches. */
export function DataEditor({
  kind,
  granularity,
  draft,
  onChange,
}: {
  kind: Kind;
  granularity: Granularity;
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const setField = (key: string, value: string) =>
    onChange({ ...draft, fields: { ...draft.fields, [key]: value } });
  const setRow = (index: number, patch: Partial<SourceCaskRow>) =>
    onChange({
      ...draft,
      sourceCasks: draft.sourceCasks.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fieldsFor(kind, granularity).map((field) => (
        <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
          <Field label={`${field.label}${field.required ? " *" : ""}`} hint={field.hint}>
            {field.type === "textarea" ? (
              <Textarea
                rows={3}
                value={draft.fields[field.key] ?? ""}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            ) : (
              <input
                className={inputClass}
                type={field.type === "date" ? "date" : "text"}
                value={draft.fields[field.key] ?? ""}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            )}
          </Field>
        </div>
      ))}
      {kind === "bottle" ? (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Source casks</legend>
          {draft.sourceCasks.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity
            <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <input
                className={`${inputClass} col-span-2 font-mono sm:col-span-1`}
                aria-label={`Source cask ${index + 1} token id`}
                placeholder="cask token id"
                value={row.tokenId}
                onChange={(event) => setRow(index, { tokenId: event.target.value })}
              />
              <input
                className={inputClass}
                aria-label={`Source cask ${index + 1} revision`}
                placeholder="revision"
                value={row.revision}
                onChange={(event) => setRow(index, { revision: event.target.value })}
              />
              <input
                className={inputClass}
                aria-label={`Source cask ${index + 1} volume in ml`}
                placeholder="volume (ml)"
                value={row.volumeMl}
                onChange={(event) => setRow(index, { volumeMl: event.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Remove source cask ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    sourceCasks: draft.sourceCasks.filter((_, i) => i !== index),
                  })
                }
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...draft,
                  sourceCasks: [...draft.sourceCasks, { tokenId: "", revision: "", volumeMl: "" }],
                })
              }
            >
              <Plus aria-hidden data-icon="inline-start" />
              Add source cask
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
