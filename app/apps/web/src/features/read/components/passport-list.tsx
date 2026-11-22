"use client";

import { MANIFEST } from "@idpp/passport-config";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FilePlus2, Loader2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inputClass } from "@/features/write/components/ui";
import { PASSPORT_STATUSES, type PassportStatus } from "@/lib/indexer/client";
import { getReadSources } from "../sources";
import { chainName } from "../timeline";
import { passportPath } from "../token-id";
import { StatusBadge, statusLabel } from "./badges";
import { MockBanner } from "./mock-banner";

const PAGE_SIZE = 20;

export function PassportList() {
  const sources = getReadSources();
  const [chainId, setChainId] = useState<number | undefined>();
  const [status, setStatus] = useState<PassportStatus | undefined>();

  const query = useInfiniteQuery({
    queryKey: ["passports", sources.mode, chainId, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      sources.listPassports({ chainId, status, limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = chainId !== undefined || status !== undefined;

  return (
    <section className="flex flex-col gap-5">
      {sources.mode === "mock" && <MockBanner />}
      <div className="grid grid-cols-2 items-end gap-4 border-y py-5 sm:flex sm:flex-wrap">
        <Label className="flex flex-col items-stretch gap-1.5 leading-normal">
          Chain
          <select
            className={`${inputClass} sm:w-48`}
            value={chainId ?? ""}
            onChange={(event) =>
              setChainId(event.target.value ? Number(event.target.value) : undefined)
            }
          >
            <option value="">All chains</option>
            {MANIFEST.chains.map((chain) => (
              <option key={chain.chainId} value={chain.chainId}>
                {chainName(chain.chainId)}
              </option>
            ))}
          </select>
        </Label>
        <Label className="flex flex-col items-stretch gap-1.5 leading-normal">
          Status
          <select
            className={`${inputClass} sm:w-48`}
            value={status ?? ""}
            onChange={(event) =>
              setStatus((event.target.value || undefined) as PassportStatus | undefined)
            }
          >
            <option value="">All statuses</option>
            {PASSPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </Label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setChainId(undefined);
              setStatus(undefined);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {query.isSuccess && items.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "passport" : "passports"} loaded
          {query.hasNextPage ? "; more available below." : "."}
        </p>
      )}
      {query.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading passports">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}
      {query.isError && (
        <Notice tone="error">
          <p>Could not load passports: {query.error.message}</p>
          <div>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              <RotateCw aria-hidden data-icon="inline-start" />
              Try again
            </Button>
          </div>
        </Notice>
      )}
      {query.isSuccess && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <p className="font-medium">
            {filtered ? "No passports match these filters." : "No passports have been issued yet."}
          </p>
          {!filtered && (
            <Link href="/mint" className={buttonVariants()}>
              <FilePlus2 aria-hidden data-icon="inline-start" />
              Mint the first passport
            </Link>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table aria-label="Passport records">
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead className="pl-4">Token id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Chain</TableHead>
                <TableHead className="hidden md:table-cell">Origin</TableHead>
                <TableHead className="hidden pr-4 text-right md:table-cell">Revision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.tokenId}>
                  <TableCell className="whitespace-normal py-3 pl-4">
                    <Link
                      className="inline-flex min-h-11 items-center break-all font-mono font-medium underline-offset-4 hover:underline"
                      href={passportPath(item.tokenId)}
                    >
                      {item.tokenId}
                    </Link>
                    <div className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground md:hidden">
                      <p>
                        {item.currentChainId === null ? "unknown" : chainName(item.currentChainId)}{" "}
                        · Revision {item.revision ?? "unknown"}
                      </p>
                      <p>Origin: {chainName(item.originChainId)}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {item.currentChainId === null ? (
                      <span className="text-muted-foreground">unknown</span>
                    ) : (
                      chainName(item.currentChainId)
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {chainName(item.originChainId)}
                  </TableCell>
                  <TableCell className="hidden pr-4 text-right font-mono tabular-nums md:table-cell">
                    {item.revision ?? <span className="text-muted-foreground">unknown</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto sm:self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Loader2 aria-hidden className="animate-spin" />}
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}
