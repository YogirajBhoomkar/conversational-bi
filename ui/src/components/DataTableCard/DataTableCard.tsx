import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Card from "../Card/Card";
import "./DataTableCard.css";

const isNumeric = (v: unknown) =>
  typeof v === "number" ||
  (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));
const humanize = (c: string) => {
  const s = c.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// Identifier-like columns (ids, years, codes) must not get thousands separators.
const NO_GROUPING = /(^|_)(id|year|code|zip|number|no)(_|$)/i;

function format(v: unknown, column: string): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    const grouped = Math.abs(v) >= 10000 && !NO_GROUPING.test(column);
    return grouped
      ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(Number.isInteger(v) ? v : Number(v.toFixed(2)));
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function DataTableCard({
  columns,
  rows,
  totalRows,
}: {
  columns: string[];
  rows: unknown[][];
  totalRows: number;
}) {
  const numeric = columns.map(
    (_, i) =>
      rows.length > 0 &&
      rows.every((r) => r[i] === null || r[i] === undefined || isNumeric(r[i])),
  );
  const preview = totalRows > rows.length;
  return (
    <Card
      title="Data table"
      meta={
        <span className="card__meta">
          {preview
            ? `Showing ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows`
            : `${rows.length.toLocaleString()} rows`}
        </span>
      }
    >
      <TableContainer className="res-table__wrap">
        <Table size="small" stickyHeader className="res-table">
          <TableHead>
            <TableRow>
              {columns.map((c, i) => (
                <TableCell
                  key={c + i}
                  className={`res-table__th${numeric[i] ? " n" : ""}`}
                >
                  {humanize(c)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow key={ri} hover>
                {columns.map((c, ci) => (
                  <TableCell
                    key={c + ci}
                    className={`res-table__td${numeric[ci] ? " n" : ""}`}
                  >
                    {format(row[ci], c)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
