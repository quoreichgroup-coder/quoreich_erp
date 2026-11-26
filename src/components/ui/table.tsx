import * as React from "react";

import { cn } from "@/lib/utils";

export interface MobileTableColumn {
  label: string;
  kind?: "selection" | "primary" | "actions";
  wide?: boolean;
  sortable?: boolean;
}

const MobileColumnsContext = React.createContext<readonly MobileTableColumn[] | undefined>(undefined);
const TableRegionContext = React.createContext<"header" | "body" | "footer">("body");
const MobileCellContext = React.createContext<MobileTableColumn | undefined>(undefined);

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  mobileColumns?: readonly MobileTableColumn[];
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, mobileColumns, ...props }, ref) => (
    <MobileColumnsContext.Provider value={mobileColumns}>
      <div className={cn("relative w-full", mobileColumns ? "md:overflow-auto" : "overflow-auto")}>
        <table ref={ref} role={mobileColumns ? "table" : undefined}
          className={cn("w-full caption-bottom text-sm", mobileColumns && "max-md:block", className)} {...props} />
      </div>
    </MobileColumnsContext.Provider>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    const columns = React.useContext(MobileColumnsContext);
    return <TableRegionContext.Provider value="header">
      <thead ref={ref} role={columns ? "rowgroup" : undefined}
        className={cn("[&_tr]:border-b", columns && (
          columns.some(column => column.kind === "selection" || column.sortable)
            ? "max-md:block max-md:border-b max-md:p-3"
            : "max-md:hidden"
        ), className)} {...props} />
    </TableRegionContext.Provider>;
  },
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    const columns = React.useContext(MobileColumnsContext);
    return <TableRegionContext.Provider value="body">
      <tbody ref={ref} role={columns ? "rowgroup" : undefined}
        className={cn(columns ? "max-md:grid max-md:gap-3 max-md:bg-muted/20 max-md:p-3 md:[&_tr:last-child]:border-0" : "[&_tr:last-child]:border-0", className)} {...props} />
    </TableRegionContext.Provider>;
  },
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    const columns = React.useContext(MobileColumnsContext);
    return <TableRegionContext.Provider value="footer">
      <tfoot ref={ref} role={columns ? "rowgroup" : undefined}
        className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", columns && "max-md:block max-md:p-3", className)} {...props} />
    </TableRegionContext.Provider>;
  },
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, children, ...props }, ref) => {
    const columns = React.useContext(MobileColumnsContext);
    const region = React.useContext(TableRegionContext);
    return <tr
      ref={ref}
      role={columns ? "row" : undefined}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", columns && (
        region === "body"
          ? "max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:rounded-lg max-md:border max-md:border-border max-md:bg-card max-md:p-4 max-md:shadow-sm"
          : "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-1 max-md:border-0 max-md:bg-transparent"
      ), className)}
      {...props}
    >
      {columns ? React.Children.toArray(children).map((child, index) => (
        <MobileCellContext.Provider key={React.isValidElement(child) ? child.key ?? index : index} value={columns[index]}>
          {child}
        </MobileCellContext.Provider>
      )) : children}
    </tr>;
  },
);
TableRow.displayName = "TableRow";

function useMobileCell(colSpan = 1) {
  const columns = React.useContext(MobileColumnsContext);
  const column = React.useContext(MobileCellContext);
  const region = React.useContext(TableRegionContext);
  const merged = colSpan > 1;
  const selection = !!columns && !merged && region !== "footer" && column?.kind === "selection";
  const label = columns && !merged && region === "body" && column?.kind !== "selection" && column?.kind !== "actions" ? column?.label : undefined;
  const classes = columns && cn(
    "max-md:min-w-0 max-md:max-w-none max-md:overflow-visible max-md:whitespace-normal max-md:break-words max-md:p-0 max-md:text-sm",
    region === "header"
      ? (selection || column?.sortable ? "max-md:block max-md:h-auto max-md:w-auto" : "max-md:hidden")
      : region === "body" && (
        merged || column?.wide || column?.kind
          ? "max-md:col-span-2"
          : undefined
      ),
    region === "header" && selection && "max-md:w-full",
    region === "header" && column?.sortable && "max-md:[&_button]:mx-0 max-md:[&_button]:min-h-11 max-md:[&_button]:text-sm",
    region === "body" && column?.kind === "primary" && "max-md:text-base max-md:font-semibold",
    region === "body" && column?.kind === "actions" && "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-2 max-md:space-x-0 max-md:border-t max-md:pt-3 max-md:[&>div]:max-w-full max-md:[&>div]:flex-wrap max-md:[&>div]:gap-2 max-md:[&_button]:min-h-11 max-md:[&_button]:whitespace-normal max-md:[&_button]:text-sm",
  );
  return { columns, region, selection, label, classes };
}

function CellContent({ children, layout }: { children: React.ReactNode; layout: ReturnType<typeof useMobileCell> }) {
  if (layout.selection) {
    return <label className="inline-flex items-center max-md:min-h-11 max-md:gap-3 max-md:[&_input]:size-5">
      {children}<span className="hidden max-md:inline">Sélectionner</span>
    </label>;
  }
  return <>
    {layout.label && <span className="mb-1 hidden font-sans text-xs font-normal text-muted-foreground max-md:block">{layout.label}</span>}
    {children}
  </>;
}

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, children, colSpan, ...props }, ref) => {
    const layout = useMobileCell(colSpan);
    return <th
      ref={ref}
      role={layout.columns ? "columnheader" : undefined}
      colSpan={colSpan}
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        layout.classes,
        className,
      )}
      {...props}
    ><CellContent layout={layout}>{children}</CellContent></th>;
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, children, colSpan, ...props }, ref) => {
    const layout = useMobileCell(colSpan);
    return <td ref={ref} role={layout.columns ? (layout.region === "header" ? "columnheader" : "cell") : undefined}
      colSpan={colSpan} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", layout.classes, className)} {...props}>
      <CellContent layout={layout}>{children}</CellContent>
    </td>;
  },
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
