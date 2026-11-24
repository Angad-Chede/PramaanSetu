"use client";

import * as React from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A native multipart form posting straight to the API, wearing a drop zone. */
export function CsvDrop({ action }: { action: string }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <form action={action} method="post" encType="multipart/form-data" className="flex flex-col gap-3">
      <label
        htmlFor="metrics-file"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped && inputRef.current) {
            const transfer = new DataTransfer();
            transfer.items.add(dropped);
            inputRef.current.files = transfer.files;
            setFile(dropped);
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-[background-color,border-color] duration-200 ease-ios",
          over ? "border-brand bg-brand/[0.06]" : "border-border bg-surface/50 hover:bg-surface",
        )}
      >
        <span className={cn("grid size-10 place-items-center rounded-xl shadow-lift", file ? "bg-success/12 text-success-ink" : "bg-card text-glyph")}>
          {file ? <FileSpreadsheet className="size-5" /> : <UploadCloud className="size-5" />}
        </span>
        <span className="text-sm font-medium">{file ? file.name : "Drop a CSV here, or browse"}</span>
        <span className="text-[12px] text-muted-foreground">{file ? Math.max(1, Math.round(file.size / 1024)) + " KB" : "Template columns only, up to one file"}</span>
        <input
          ref={inputRef}
          id="metrics-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <Button type="submit" disabled={!file} className="w-full">
        Upload the file
      </Button>
    </form>
  );
}
