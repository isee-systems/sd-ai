import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Plot from 'react-plotly.js';
import DataTable from 'react-data-table-component';
import leaderboards from '../generated/leaderboards.json';
import { leaderboardConfig } from './leaderboardMeta';
import {
  SEQUENTIAL_BLUE,
  INK_FLIP_AT,
  CATEGORICAL,
  CHROME,
  CHART_FONT,
  camelCaseToWords,
  wrapLabel,
  rampStep,
} from './leaderboardTheme';

/** Row labels have to fit a fixed gutter; the full name is always in the hover. */
const truncate = (s) => (s.length > 42 ? `${s.slice(0, 41)}…` : s);

const Panel = ({ title, subtitle, children }) => (
  <section className="mb-6 sm:mb-8">
    <h2 className="text-xl sm:text-2xl font-bold mb-1 text-gray-800">{title}</h2>
    {subtitle && <p className="text-sm text-gray-600 mb-3">{subtitle}</p>}
    <div className="bg-white p-2 sm:p-4 border border-gray-200 rounded-lg">{children}</div>
  </section>
);

/** RFC-4180 quoting: anything with a comma, quote or newline has to be wrapped. */
const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const PLOT_CONFIG = {
  displayModeBar: false,
  responsive: true,
  displaylogo: false,
};

function Leaderboard() {
  const { mode } = useParams();
  const navigate = useNavigate();
  // The full matrix is still the source of truth, so it stays one click away — collapsed
  // by default because it is the wide, side-scrolling view the charts exist to replace.
  const [showRaw, setShowRaw] = useState(false);

  const config = leaderboardConfig[mode];
  const leaderboardData = leaderboards[mode] || null;

  // Generations present in this board, and whether any of them carries a warning about
  // its own results. A newer run overwrites the older result for a test, so a board is
  // a single current table — the generation only records which benchmark version each
  // surviving row came from.
  const generations = leaderboardData?.generations ?? [];
  const caveated = generations.filter((g) => g.caveat && g.count > 0);

  const backLink = (
    <div className="mb-4">
      <Link to="/leaderboards" className="text-blue-600 hover:text-blue-800 no-underline">
        ← All leaderboards
      </Link>
    </div>
  );

  if (!config || !leaderboardData) {
    return (
      <div className="leaderboard-page py-3 sm:py-5">
        {backLink}
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 mb-4">
          <strong>Error:</strong> No leaderboard data available for mode: {mode}
        </div>
      </div>
    );
  }

  // Sorted once. The rank used to be recomputed inside the cell renderer, which re-sorted
  // the whole board for every row it drew.
  const ranked = [...leaderboardData.engines].sort((a, b) => b.score - a.score);
  const rankOf = new Map(ranked.map((engine, i) => [engine.configName, i + 1]));

  // Alphabetical rather than first-seen: the order a category happens to appear in the
  // results file is arbitrary, and a column order that shifts between runs makes two
  // screenshots of the same board hard to compare.
  const categories = [...leaderboardData.categories].sort((a, b) =>
    camelCaseToWords(a).localeCompare(camelCaseToWords(b))
  );

  const isCaveated = (engine) =>
    (engine.generations ?? []).some((id) => caveated.some((g) => g.id === id));

  /* ------------------------------------------------------------ per-category grid */

  // The per-category scores were twelve numeric columns, which pushed the table into
  // horizontal scrolling — the one interaction that makes a wide table unreadable, since
  // the engine name scrolls away from the number you are reading. The same values as a
  // heatmap fit the page width whatever the category count, and comparing down a column
  // or across a row becomes a glance instead of a scroll.
  const heatmapZ = ranked.map((engine) => categories.map((c) => engine[c] ?? null));
  const heatmapHeight = Math.max(340, ranked.length * 26 + 190);

  // A number in every cell is noise once the grid is large, and the skill's own rule is
  // selective labelling. Past ~20 engines the colour carries the comparison and the hover
  // carries the exact figure.
  const labelCells = ranked.length <= 20;
  const cellLabels = labelCells
    ? ranked.flatMap((engine, row) =>
        categories
          .map((category, col) => {
            const value = engine[category];
            if (value == null) return null;
            return {
              x: col,
              y: row,
              text: `${Math.round(value * 100)}%`,
              showarrow: false,
              font: {
                ...CHART_FONT,
                size: 11,
                // The ramp crosses into dark at its midpoint, so ink flips there.
                color: value >= INK_FLIP_AT ? '#ffffff' : CHROME.textPrimary,
              },
            };
          })
          .filter(Boolean)
      )
    : [];

  /* ------------------------------------------------------------------- cost chart */

  // Results predating cost tracking have none, and a board can be entirely unpriced.
  const priced = ranked.filter((e) => e.costPerTest != null);

  // Which engine family a point belongs to is an identity distinction, so it gets hue.
  // Two families are direct-labelled and legended; a longer tail folds into a muted
  // "Other" rather than growing the palette.
  const familyCounts = priced.reduce((acc, e) => {
    acc[e.engineName] = (acc[e.engineName] ?? 0) + 1;
    return acc;
  }, {});
  const namedFamilies = Object.entries(familyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CATEGORICAL.length)
    .map(([name]) => name);
  const familyOf = (engine) => (namedFamilies.includes(engine.engineName) ? engine.engineName : 'Other');
  const costSeries = [...namedFamilies, ...(priced.some((e) => familyOf(e) === 'Other') ? ['Other'] : [])];

  const costTraces = costSeries.map((family, i) => {
    const members = priced.filter((e) => familyOf(e) === family);
    return {
      x: members.map((e) => e.score),
      y: members.map((e) => e.costPerTest),
      text: members.map((e) => e.llmModel),
      customdata: members.map((e) => [e.configName, e.costTotal, e.costUnpricedCalls]),
      name: family,
      mode: 'markers+text',
      type: 'scatter',
      textposition: 'top center',
      textfont: { ...CHART_FONT, size: 10, color: CHROME.textSecondary },
      marker: {
        size: 13,
        color: namedFamilies.includes(family) ? CATEGORICAL[i] : CHROME.muted,
        // A surface ring keeps two points that land on each other readable as two.
        line: { width: 2, color: '#ffffff' },
      },
      hovertemplate:
        '<b>%{customdata[0]}</b><br>%{text}<br>' +
        'Score: %{x:.1%}<br>Cost/test: $%{y:.4f}<br>' +
        'Benchmark total: $%{customdata[1]:.2f}<extra></extra>',
    };
  });

  const unpricedNote = ranked.length - priced.length;

  /* --------------------------------------------------------------------- raw data */

  // Header plus one row per engine, in the same order the page shows. Cost stays blank
  // rather than 0 for unpriced rows so a spreadsheet won't average "free" into the column.
  const csvRows = [
    ['rank', 'engineConfig', 'engine', 'llmModels', 'overallScore', 'avgCostPerTest',
     'benchmarkCostTotal', 'avgSecondsPerTest', 'generations', ...categories],
    ...ranked.map((engine) => [
      rankOf.get(engine.configName),
      engine.configName,
      engine.engineName,
      (engine.llmModels ?? []).join(' + '),
      engine.score.toFixed(6),
      engine.costPerTest == null ? '' : engine.costPerTest.toFixed(6),
      engine.costTotal == null ? '' : engine.costTotal.toFixed(4),
      engine.speed.toFixed(3),
      (engine.generations ?? []).join(' '),
      ...categories.map((c) => (engine[c] == null ? '' : engine[c].toFixed(6))),
    ]),
  ];

  return (
    <div className="leaderboard-page py-3 sm:py-5">
      {backLink}

      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3 text-gray-800">
          {config.title} Leaderboard
        </h1>
        <p className="text-base text-gray-600 mb-4">{config.description}</p>

        {/* A generation whose own results are known to be unreliable says so on the
            page, not just in the repo. A number shown without its caveat gets quoted
            without it. */}
        {caveated.map((g) => (
          <div
            key={g.id}
            className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900"
          >
            <strong>{g.label} results:</strong> {g.caveat} {g.count} of the{' '}
            {generations.reduce((n, x) => n + x.count, 0)} results on this board are still
            from {g.label} — the Results column marks which engines they belong to.
          </div>
        ))}
      </div>

      {/* Headline numbers only. Everything per-category moved to the heatmap below, which
          is what keeps this table inside the page width. */}
      <Panel
        title="Standings"
        subtitle="Overall score, plus cost and wall-clock time per test. Per-category scores are in the grid below."
      >
        <DataTable
          columns={[
            {
              name: '#',
              selector: (row) => rankOf.get(row.configName),
              sortable: true,
              width: '64px',
            },
            {
              name: 'Engine',
              selector: (row) => row.configName,
              sortable: true,
              grow: 3,
              minWidth: '260px',
              cell: (row) => (
                <div className="py-1">
                  <Link
                    to={`/engines/${row.engineName}`}
                    className="text-blue-600 hover:text-blue-800 no-underline font-medium"
                  >
                    {row.engineName}
                  </Link>
                  <div className="text-xs text-gray-500 mt-0.5">{row.configName}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(row.llmModels ?? []).length === 0 ? (
                      <span
                        className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded"
                        title="This engine drives no LLM of its own"
                      >
                        no LLM
                      </span>
                    ) : (
                      row.llmModels.map((model) => (
                        <span
                          key={model}
                          className="inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded"
                        >
                          {model}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ),
            },
            {
              name: 'Score',
              selector: (row) => row.score,
              sortable: true,
              format: (row) => `${(row.score * 100).toFixed(1)}%`,
              width: '110px',
            },
            {
              name: 'Cost / Test',
              // Results produced before evals captured cost have none. Sorting them
              // below every priced engine keeps "cheapest first" meaningful; the cell
              // still renders an em dash so unknown never reads as free.
              selector: (row) => row.costPerTest ?? Number.MAX_VALUE,
              sortable: true,
              width: '130px',
              cell: (row) =>
                row.costPerTest == null ? (
                  <span className="text-gray-400" title="These results predate cost tracking">
                    —
                  </span>
                ) : (
                  <span
                    title={
                      `$${row.costTotal.toFixed(2)} total across the benchmark` +
                      (row.costUnpricedCalls > 0
                        ? ` — at least, ${row.costUnpricedCalls} call(s) used a model with no published pricing`
                        : '')
                    }
                  >
                    ${row.costPerTest.toFixed(4)}
                    {row.costUnpricedCalls > 0 && <span className="text-amber-600">*</span>}
                  </span>
                ),
            },
            {
              name: 'Time / Test',
              selector: (row) => row.speed,
              sortable: true,
              format: (row) => `${row.speed.toFixed(1)}s`,
              width: '130px',
            },
            ...(generations.length > 1
              ? [{
                  name: 'Results',
                  // Which benchmark generation this engine's numbers come from. Only
                  // worth a column once a board holds more than one, and it shows the
                  // mix rather than a single label because a partly re-run engine
                  // genuinely is part-old.
                  selector: (row) => (row.generations ?? []).join(','),
                  sortable: true,
                  width: '120px',
                  cell: (row) => (
                    <span
                      className="flex flex-wrap gap-1"
                      title={Object.entries(row.generationCounts ?? {})
                        .map(([id, n]) => `${n} result(s) from ${id}`)
                        .join(', ')}
                    >
                      {(row.generations ?? []).map((id) => (
                        <span
                          key={id}
                          className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                            caveated.some((g) => g.id === id)
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-indigo-50 text-indigo-700'
                          }`}
                        >
                          {id}
                        </span>
                      ))}
                    </span>
                  ),
                }]
              : []),
          ]}
          data={ranked}
          defaultSortFieldId={1}
          pagination={false}
          highlightOnHover
          striped
          responsive
          customStyles={{
            table: { style: { minWidth: '100%', border: 'none' } },
            headRow: {
              style: {
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid #d1d5db',
                minHeight: '44px',
              },
            },
            headCells: {
              style: {
                padding: '8px 12px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
              },
            },
            cells: {
              style: {
                padding: '10px 12px',
                fontSize: '14px',
                color: '#374151',
                borderBottom: '1px solid #e5e7eb',
              },
            },
            rows: { style: { minHeight: '56px', '&:hover': { backgroundColor: '#f3f4f6' } } },
          }}
        />
      </Panel>

      {/* Per-category scores */}
      <Panel
        title="Scores by Category"
        subtitle={
          labelCells
            ? 'Darker is better. Hover a cell for the exact figure; blank means the engine did not run that category.'
            : `Darker is better. Hover a cell for the exact figure — with ${ranked.length} engines the cells are left unlabelled. Blank means the engine did not run that category.`
        }
      >
        {/* The old per-column "View" buttons lived in the table header. They move here so
            the link to each category's test survives the switch to a heatmap. */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {categories.map((category) => {
            const test = leaderboardData.categoryFirstTests[category];
            return (
              <button
                key={category}
                onClick={() =>
                  navigate(
                    `/evals/${encodeURIComponent(test.category)}/${encodeURIComponent(test.group)}/${encodeURIComponent(test.testName)}`
                  )
                }
                className="px-2 py-1 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-900 rounded"
                title={`View a ${camelCaseToWords(category)} test`}
              >
                {camelCaseToWords(category)} ↗
              </button>
            );
          })}
        </div>

        <Plot
          data={[
            {
              type: 'heatmap',
              x: categories.map((c) => wrapLabel(c)),
              y: ranked.map((e) => truncate(e.configName)),
              z: heatmapZ,
              zmin: 0,
              zmax: 1,
              colorscale: SEQUENTIAL_BLUE,
              hoverongaps: false,
              // A 2px surface gap between fills, per the mark spec.
              xgap: 2,
              ygap: 2,
              customdata: ranked.map((e) => categories.map(() => e.configName)),
              hovertemplate:
                '<b>%{customdata}</b><br>%{x}<br>Score: %{z:.1%}<extra></extra>',
              colorbar: {
                title: { text: 'Score', side: 'right', font: { ...CHART_FONT, size: 11 } },
                tickformat: '.0%',
                thickness: 12,
                len: 0.6,
                outlinewidth: 0,
                tickfont: { ...CHART_FONT, size: 10, color: CHROME.muted },
              },
            },
          ]}
          layout={{
            autosize: true,
            annotations: cellLabels,
            xaxis: {
              type: 'category',
              side: 'top',
              tickfont: { ...CHART_FONT, size: 11, color: CHROME.textSecondary },
              ticks: '',
              showgrid: false,
              zeroline: false,
            },
            yaxis: {
              type: 'category',
              // Plotly draws categories bottom-up; the board reads best-first.
              autorange: 'reversed',
              tickfont: { ...CHART_FONT, size: 11, color: CHROME.textSecondary },
              ticks: '',
              showgrid: false,
              zeroline: false,
            },
            margin: { t: 90, r: 20, b: 20, l: 290 },
            font: CHART_FONT,
            plot_bgcolor: 'rgba(0,0,0,0)',
            paper_bgcolor: 'rgba(0,0,0,0)',
            hovermode: 'closest',
          }}
          config={PLOT_CONFIG}
          style={{ width: '100%', height: `${heatmapHeight}px` }}
          useResizeHandler={true}
        />
      </Panel>

      {/* Raw data — the wide matrix, on request. The charts above replace it as the
          default view; they don't replace the need to read the actual numbers. */}
      <section className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Raw Data</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              aria-expanded={showRaw}
            >
              {showRaw ? 'Hide table' : 'Show table'}
            </button>
            <button
              onClick={() => downloadCsv(`sd-ai-${mode}-leaderboard.csv`, csvRows)}
              className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              ⤓ Download CSV
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          Every score behind the charts, {ranked.length} engines × {categories.length}{' '}
          categories. This is the wide view — it scrolls sideways, with the engine column
          pinned so the name stays with the number.
        </p>

        {showRaw && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-20 bg-gray-50 text-left font-semibold text-gray-700 px-3 py-2 border-b border-r border-gray-300 min-w-[240px]">
                    Engine
                  </th>
                  <th className="text-right font-semibold text-gray-700 px-3 py-2 border-b border-gray-300 whitespace-nowrap">
                    Score
                  </th>
                  <th className="text-right font-semibold text-gray-700 px-3 py-2 border-b border-gray-300 whitespace-nowrap">
                    Cost / Test
                  </th>
                  <th className="text-right font-semibold text-gray-700 px-3 py-2 border-b border-r border-gray-300 whitespace-nowrap">
                    Time / Test
                  </th>
                  {categories.map((category) => (
                    <th
                      key={category}
                      className="text-center font-semibold text-gray-700 px-3 py-2 border-b border-gray-300 align-bottom"
                    >
                      <span className="block max-w-[110px] mx-auto leading-tight text-xs">
                        {camelCaseToWords(category)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((engine) => (
                  <tr key={engine.configName} className="hover:bg-gray-50">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white text-left font-normal px-3 py-2 border-b border-r border-gray-200"
                    >
                      <span className="text-gray-400 mr-1">{rankOf.get(engine.configName)}.</span>
                      <Link
                        to={`/engines/${engine.engineName}`}
                        className="text-blue-600 hover:text-blue-800 no-underline font-medium"
                      >
                        {engine.configName}
                      </Link>
                      <span className="block text-xs text-gray-500">
                        {(engine.llmModels ?? []).length ? engine.llmModels.join(' + ') : 'no LLM'}
                      </span>
                    </th>
                    <td className="text-right px-3 py-2 border-b border-gray-200 font-medium whitespace-nowrap">
                      {(engine.score * 100).toFixed(1)}%
                    </td>
                    <td className="text-right px-3 py-2 border-b border-gray-200 whitespace-nowrap">
                      {engine.costPerTest == null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        `$${engine.costPerTest.toFixed(4)}`
                      )}
                    </td>
                    <td className="text-right px-3 py-2 border-b border-r border-gray-200 whitespace-nowrap">
                      {engine.speed.toFixed(1)}s
                    </td>
                    {categories.map((category) => {
                      const value = engine[category];
                      if (value == null) {
                        return (
                          <td
                            key={category}
                            className="text-center px-3 py-2 border-b border-gray-200 text-gray-300"
                            title="Not run for this engine"
                          >
                            —
                          </td>
                        );
                      }
                      const { bg, fg } = rampStep(value);
                      return (
                        <td
                          key={category}
                          className="text-center px-3 py-2 border-b border-gray-200 whitespace-nowrap"
                          style={{ backgroundColor: bg, color: fg }}
                        >
                          {(value * 100).toFixed(0)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost */}
      <Panel
        title="Cost vs. Performance"
        subtitle="Spend per test against overall score, on the same x axis as the speed chart below. Down and to the right is better: more accuracy for less money."
      >
        {priced.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            No cost data on this board yet. Cost is recorded from the {' '}
            <span className="font-medium">v2</span> generation onward, so this chart fills in
            once a v2 run has been merged here.
          </div>
        ) : (
          <>
            <Plot
              data={costTraces}
              layout={{
                autosize: true,
                xaxis: {
                  // Identical to the speed chart's x axis so the two stack and compare.
                  title: { text: 'Score (% correct)', standoff: 20 },
                  range: [0, 1.13],
                  tickformat: '.0%',
                  showgrid: true,
                  gridcolor: CHROME.gridline,
                  zeroline: false,
                  linecolor: CHROME.axis,
                  tickfont: { ...CHART_FONT, color: CHROME.muted },
                },
                yaxis: {
                  title: { text: 'Avg cost per test (USD)', standoff: 20 },
                  type: 'log',
                  tickprefix: '$',
                  showgrid: true,
                  gridcolor: CHROME.gridline,
                  zeroline: false,
                  linecolor: CHROME.axis,
                  tickfont: { ...CHART_FONT, color: CHROME.muted },
                },
                margin: { t: 20, r: 30, b: 60, l: 80 },
                font: CHART_FONT,
                showlegend: costTraces.length > 1,
                legend: { orientation: 'h', y: -0.18, font: { ...CHART_FONT, size: 11 } },
                hovermode: 'closest',
                plot_bgcolor: 'rgba(0,0,0,0)',
                paper_bgcolor: 'rgba(0,0,0,0)',
              }}
              config={PLOT_CONFIG}
              style={{ width: '100%', height: '520px' }}
              useResizeHandler={true}
            />
            {unpricedNote > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {unpricedNote} of {ranked.length} engines are not plotted — their results
                predate cost tracking. They still appear in the standings above with an em
                dash for cost.
              </p>
            )}
          </>
        )}
      </Panel>

      {/* Speed */}
      <Panel
        title="Performance vs. Speed"
        subtitle="Overall score against average wall-clock time per test."
      >
        <Plot
          data={[
            {
              x: ranked.map((e) => e.score),
              y: ranked.map((e) => e.speed),
              text: ranked.map((e) =>
                e.engineName === 'qualitative-zero' ? `${e.llmModel}` : `${e.engineName} (${e.llmModel})`
              ),
              customdata: ranked.map((e) => e.configName),
              mode: 'markers+text',
              type: 'scatter',
              textposition: 'right center',
              hovertemplate:
                '<b>%{customdata}</b><br>Score: %{x:.1%}<br>Avg time: %{y:.1f}s<extra></extra>',
              marker: {
                size: 12,
                opacity: 0.7,
                // Engines still carrying results from a caveated generation are
                // drawn in that warning colour, so the chart doesn't present a
                // flagged score as though it were on equal footing.
                color: ranked.map((e) => {
                  if (e.engineName === 'qualitative-zero') return 'rgba(102, 102, 102, 0.8)';
                  return isCaveated(e) ? 'rgba(217, 143, 38, 0.82)' : 'rgba(186, 72, 72, 0.82)';
                }),
                line: { width: 0 },
              },
              textfont: { ...CHART_FONT, size: 10 },
            },
          ]}
          layout={{
            autosize: true,
            xaxis: {
              title: { text: 'Score (% correct)', standoff: 20 },
              range: [0, 1.13],
              tickformat: '.0%',
              showgrid: true,
              gridcolor: CHROME.gridline,
              zeroline: false,
              linecolor: CHROME.axis,
              tickfont: { ...CHART_FONT, color: CHROME.muted },
            },
            yaxis: {
              title: { text: 'Avg time per test (seconds)', standoff: 20 },
              type: 'log',
              showgrid: true,
              gridcolor: CHROME.gridline,
              zeroline: false,
              linecolor: CHROME.axis,
              tickfont: { ...CHART_FONT, color: CHROME.muted },
            },
            margin: { t: 10, r: 30, b: 50, l: 80 },
            font: CHART_FONT,
            showlegend: false,
            hovermode: 'closest',
            plot_bgcolor: 'rgba(0,0,0,0)',
            paper_bgcolor: 'rgba(0,0,0,0)',
          }}
          config={PLOT_CONFIG}
          style={{ width: '100%', height: '760px' }}
          useResizeHandler={true}
        />
      </Panel>
    </div>
  );
}

export default Leaderboard;
