import type { PulseBlock } from "@elyia/core/pulse";
import { useMemo } from "react";

import { useNow } from "../../hooks/useNow";
import { formatAgeMs, formatBlockNumber, formatGas } from "../../lib/format";
import { DataTable, type DataColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";

export interface BlockFeedProps {
  readonly recent: readonly PulseBlock[];
  /** Local wall clock when the newest block arrived (ages are skew-free relative to it). */
  readonly lastBlockAt: number | null;
  readonly rows?: number;
  readonly loading?: boolean;
}

interface Row {
  readonly block: PulseBlock;
  readonly ageMs: number | null;
  readonly newest: boolean;
}

/**
 * The live block list. Ages are measured from the newest block's local arrival,
 * offset by the server's own seenAt differences, so a skewed client clock
 * never shows negative or inflated ages.
 */
export function BlockFeed({ recent, lastBlockAt, rows = 12, loading = false }: BlockFeedProps) {
  const now = useNow(250);
  const data = useMemo<Row[]>(() => {
    const head = recent[recent.length - 1];
    return recent
      .slice(-rows)
      .reverse()
      .map((block) => ({
        block,
        newest: block === head,
        ageMs: head && lastBlockAt !== null ? now - lastBlockAt + (head.seenAt - block.seenAt) : null,
      }));
  }, [recent, rows, lastBlockAt, now]);

  const columns: DataColumn<Row>[] = [
    { id: "number", header: "Block", numeric: true, cell: (row) => <span title={row.block.hash}>{formatBlockNumber(row.block.number)}</span> },
    { id: "txs", header: "Txs", align: "right", cell: (row) => row.block.txCount },
    { id: "gas", header: "Gas used", align: "right", cell: (row) => formatGas(row.block.gasUsed) },
    { id: "age", header: "Age", align: "right", cell: (row) => formatAgeMs(row.ageMs) },
  ];

  return (
    <DataTable
      caption="Latest Elysium testnet blocks, newest first"
      columns={columns}
      rows={data}
      getRowId={(row) => row.block.hash}
      isRowHighlighted={(row) => row.newest}
      isRowMuted={(row) => (row.ageMs ?? 0) > 1_500}
      stickyHeader={false}
      loading={loading}
      loadingRows={rows}
      empty={<EmptyState compact title="No blocks yet" description="Waiting for the first Elysium block." />}
    />
  );
}
