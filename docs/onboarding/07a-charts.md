# 07a. Charts

## What you will learn
- How a chart gets from Genie to the screen.
- What the neutral chart spec looks like.
- The three chart libraries, and how to switch between them.
- How to ship just one library.
- How to add a chart type.

## The idea

The server does not choose a chart library. It builds a plain description of the chart, called a **chart spec**. The browser then draws that description with one library. The library is chosen in one file. This keeps the choice open: you can lift the code into another environment and keep only the library that environment supports.

## The chart spec

Defined in `server/src/contracts.ts` (`ChartSpecSchema`) and copied by hand to `ui/src/types.ts` (`ChartSpec`).

| Field | Meaning |
|---|---|
| `type` | `bar`, `line` or `scatter` |
| `title` | Shown above the chart by `Details` |
| `x`, `y` | Names of the data fields to plot |
| `color` | Optional. A field that splits the data into series |
| `xType` | `category`, `time` or `number` |
| `data` | The rows, as objects. `y` is always a number |

## How the server builds it

`parseGenieChartJson` and `buildChartSpec` in `server/src/mastra/chartSpec.ts`:

- Genie sends one cell of JSON: `{type, title, x, y, series, data}`.
- Type names `column` and `bar` become `bar`. `line` and `scatter` stay. Anything else gives **no chart**. The table is still shown, and a warning is logged.
- `xType` is `number` for scatter, `time` for a line whose x values are all dates, and `category` otherwise. Bars with dates are treated as categories.
- Numbers sent as text are turned into real numbers.
- For `time`, the rows are sorted by date.

```ts
const xType: ChartSpec['xType'] = type === 'scatter' ? 'number' : type === 'line' && rows.every((row) => isDate(row[xi])) ? 'time' : 'category';
```

Notice that the date check is a pattern on the text: four digits, a dash, two digits.

## The three renderers

All in `ui/src/charts/`. Each exports one component, `Chart`, that takes a `ChartSpec`.

| File | Library | Notes |
|---|---|---|
| `RechartsChart.tsx` | Recharts | Enabled by default. Stacked bars for series |
| `PlotlyChart.tsx` | Plotly (the slim `plotly.js-basic-dist-min`) | Largest bundle |
| `D3Chart.tsx` | D3, drawing SVG by hand | Smallest bundle. Most code |
| `shared.ts` | none | Colour palette, height, `toSeries`, number format |
| `plotly.d.ts` | none | A type declaration so TypeScript accepts the Plotly bundle |
| `index.ts` | none | **The switch** |

`index.ts` today:

```ts
export { Chart } from './RechartsChart';
// export { Chart } from './PlotlyChart';
// export { Chart } from './D3Chart';
```

Keep exactly one line active. `Details` imports `Chart` from `./charts`, so nothing else changes (`ui/src/components.tsx`).

Bundle sizes when each was built (from build output during development): about 643 kB for Recharts, 1,457 kB for Plotly, 306 kB for D3. These change with versions.

## How to ship one library

1. Choose one line in `ui/src/charts/index.ts`.
2. Delete the other two renderer files. If you keep Recharts or D3, also delete `plotly.d.ts`.
3. Uninstall the unused packages in `ui/`. For example, to keep Recharts, remove `plotly.js-basic-dist-min`, `@types/plotly.js`, `d3` and `@types/d3`.
4. Run `npm run build` in `ui/`.

Do not delete files before step 1. TypeScript checks every file in `ui/src` even when the switch does not import it (`ui/tsconfig.json`, `include: ["src"]`). So all three packages must stay installed until you delete the files.

## How to add a chart type

1. Server: in `server/src/mastra/chartSpec.ts`, map the new type name to a `type`, and extend `ChartSpecSchema` in `server/src/contracts.ts`.
2. Browser: extend `ChartSpec` in `ui/src/types.ts` and draw the new type in **all three** renderers (or only in the one you keep).
3. Agent text: the supervisor's instructions say only bar or column, line and scatter are drawn. Update that sentence in `server/src/mastra/agents/index.ts`.
4. Add a test in `server/src/mastra/chartSpec.test.ts`.

## Failure handling

If a chart throws while drawing, `ChartBoundary` in `ui/src/components.tsx` hides it and logs `[chart] could not draw`. The most likely cause is a server that still sends an old chart format. See [14-gotchas.md](14-gotchas.md).

## Key takeaways
- The server sends a neutral chart spec. The browser draws it with one library.
- Switch libraries by editing one line in `ui/src/charts/index.ts`.
- To ship one library, delete the other files first, then uninstall their packages.
- Unsupported chart types give a table and no chart.

## Where to look in the code
- `server/src/mastra/chartSpec.ts`: `buildChartSpec`, `parseGenieChartJson`.
- `server/src/contracts.ts`: `ChartSpecSchema`.
- `ui/src/charts/index.ts`: the switch.
- `ui/src/charts/shared.ts`: shared helpers.
- `ui/src/components.tsx`: where `Chart` is used.
